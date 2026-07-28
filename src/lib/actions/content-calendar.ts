"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";
import { getContentCalendarConfig, appendContentCalendarFeedback } from "@/lib/content-calendar/config";
import { fetchTrendCandidates, type TrendCandidate } from "@/lib/scrape/trend-pull";
import { generateSlotContent, selectTopic, generateBriefing } from "@/lib/ai/content-calendar";
import { judgeCandidates } from "@/lib/ai/content-calendar-judge";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { findNearDuplicate } from "@/lib/utils/text-similarity";
import { findStaleYear } from "@/lib/utils/year-check";
import { buildPillarAssignments } from "@/lib/content-calendar/pillar-rotation";
import {
  getNextPosition,
  getNextScheduledDate,
  getOpenQueueDepth,
  retireStaleSlots,
  todayIso,
} from "@/lib/services/content-calendar-lifecycle";
import { MAX_BATCH_SIZE, MAX_QUEUE_DEPTH } from "@/lib/types/content-calendar";
import { createR2PresignedPut, r2PublicUrl } from "@/lib/storage/r2";
import { randomUUID } from "crypto";

type ActionResult<T = unknown> =
  | ({ success: true } & T)
  | { success: false; error: string };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Inner, per-slot, per-round retries against the cheap DETERMINISTIC checks
// only (near-duplicate, stale year) — no LLM judge call spent until a
// candidate clears these for free.
const MAX_DEDUPE_ATTEMPTS = 3;
// Outer self-correcting loop cap: generate → validate (deterministic +
// judge) → regenerate ONLY the rejected slots → repeat. Bounds total cost
// (design constraint) while still giving the loop room to converge on a
// clean batch instead of shipping whatever the first attempt produced.
const MAX_ROUNDS = 5;

interface TopicCandidate {
  topicTitle: string;
  searchQuery: string;
  pillar: string;
  format: string;
}

interface BatchRejection {
  round: number;
  pillar: string;
  title: string;
  reason: string;
}

async function requireEnabledTenant(): Promise<
  { ok: true; tenantSlug: string; userId: string } | { ok: false; error: string }
> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "No tenant selected" };
  if (!isContentCalendarEnabledForTenant(tenant.slug)) {
    return { ok: false, error: "Content calendar not enabled for this tenant" };
  }
  return { ok: true, tenantSlug: tenant.slug, userId: user.id };
}

// Generates the next N slots in one batch. Runs synchronously (no durable-
// runner tables — design doc ENG REVIEW, locked decision #1/#6): N is
// capped, concurrency-limited, and the route this is called from should
// set an explicit maxDuration sized to real measured per-slot latency.
//
// Self-correcting loop (2026-07-28 rework): generate → validate against the
// full quality rubric (uniqueness, current year, on-lane + individual-brand
// fit, format/skeleton variety) → regenerate ONLY the slots that failed,
// telling the model exactly why → repeat, up to MAX_ROUNDS. A slot that
// still can't pass by the cap is DROPPED, not padded with a failing
// candidate — the batch yields fewer than N with the reason surfaced,
// rather than silently shipping junk.
export async function generateNextBatch(
  requestedN: number,
  instruction?: string
): Promise<
  ActionResult<{
    candidatesFound: number;
    generated: number;
    errors: number;
    roundsUsed: number;
    rejected: BatchRejection[];
    missingPillars: string[];
  }>
> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };
  const { tenantSlug, userId } = gate;

  const admin = createAdminClient();
  await retireStaleSlots(admin, tenantSlug);

  const openDepth = await getOpenQueueDepth(admin, tenantSlug);
  if (openDepth >= MAX_QUEUE_DEPTH) {
    return {
      success: false,
      error: `Queue is at its cap (${MAX_QUEUE_DEPTH} open slots) — work through some before generating more.`,
    };
  }

  const n = Math.max(1, Math.min(requestedN, MAX_BATCH_SIZE, MAX_QUEUE_DEPTH - openDepth));
  const config = await getContentCalendarConfig(tenantSlug);
  const currentYear = new Date().getUTCFullYear();
  const today = todayIso();

  // Fetched ONCE per pillar, shared across all N slots (locked decision
  // #4) — not re-fetched per slot. Kept keyed BY pillar (not flattened
  // immediately) so each pillar's own topic-selection calls can be grounded
  // on its own trend pool — flattening-then-slicing-top-15 previously let
  // whichever pillar had the richest fetch results crowd out every other
  // pillar's material from what the model ever saw.
  const trendsPerNiche = await Promise.all(config.niches.map((niche) => fetchTrendCandidates(niche)));
  const trendsByPillar = new Map(config.niches.map((niche, i) => [niche, trendsPerNiche[i]]));
  const trends = trendsPerNiche.flat();
  if (trends.length === 0 && config.interestTags.length === 0) {
    return {
      success: false,
      error:
        "Couldn't find any trends and no interest tags are configured — nothing to generate from. Add interest tags in settings or try again later.",
    };
  }

  // Dedup pool: seeded with titles (and pillars/formats, for rotation)
  // already in the open queue from a PRIOR batch call, PLUS recently
  // posted/filmed titles — a fresh batch shouldn't re-pitch something the
  // creator already made, and the open-queue-only exclude list had no
  // visibility into that at all. Grows as this round loop accepts new
  // candidates, so later rounds/pillars see everything accepted so far.
  const { data: existingOpenSlots } = await admin
    .from("content_slots")
    .select("topic_title, topic_brief")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"]);
  const { data: recentHistorySlots } = await admin
    .from("content_slots")
    .select("topic_title")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["posted", "filmed"])
    .order("updated_at", { ascending: false })
    .limit(30);
  const acceptedTitles: string[] = [
    ...(existingOpenSlots ?? []).map((s) => s.topic_title as string),
    ...(recentHistorySlots ?? []).map((s) => s.topic_title as string),
  ];
  const acceptedPillars: string[] = (existingOpenSlots ?? [])
    .map((s) => (s.topic_brief as { pillar?: string | null } | null)?.pillar)
    .filter((p): p is string => !!p);
  const acceptedFormats: string[] = (existingOpenSlots ?? [])
    .map((s) => (s.topic_brief as { format?: string | null } | null)?.format)
    .filter((f): f is string => !!f);

  // Guarantees every configured pillar gets an assigned slot instead of
  // leaving coverage to a soft "spread pillars" instruction. Mathematically
  // impossible to fully satisfy when n < pillar count — logged, not treated
  // as a bug, in that case.
  const pillarAssignments = buildPillarAssignments(config.niches, n);
  if (n < config.niches.length) {
    console.warn(
      `[content-calendar] batch size ${n} is smaller than pillar count ${config.niches.length} — full pillar coverage isn't possible this batch.`
    );
  }

  const slots: Array<TopicCandidate | null> = new Array(n).fill(null);
  const correctionNotes: Array<string | undefined> = new Array(n).fill(undefined);
  const rejectionLog: BatchRejection[] = [];
  let roundsUsed = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    roundsUsed = round + 1;
    const pendingIndices: number[] = [];
    slots.forEach((s, i) => { if (s === null) pendingIndices.push(i); });
    if (pendingIndices.length === 0) break;

    // Phase 1: generate ONE candidate per still-pending slot, sequentially
    // within the round (each pick must see every earlier pick THIS round —
    // concurrency here let duplicate/rephrased topics slip through in
    // production, since parallel calls can't see each other's pick).
    // Cheap deterministic checks (near-duplicate, stale year) run inline,
    // for free, before a candidate is even worth spending a judge call on.
    const roundCandidates: Array<TopicCandidate & { index: number }> = [];
    for (const i of pendingIndices) {
      const assignedPillar = pillarAssignments[i];
      const pillarTrends = trendsByPillar.get(assignedPillar);
      const trendsForPick = pillarTrends && pillarTrends.length > 0 ? pillarTrends : trends;
      const excludeSoFar = [...acceptedTitles, ...roundCandidates.map((c) => c.topicTitle)];

      let cleared: TopicCandidate | null = null;
      for (let attempt = 0; attempt < MAX_DEDUPE_ATTEMPTS && !cleared; attempt++) {
        let candidate: TopicCandidate;
        try {
          candidate = await selectTopic({
            tenantSlug,
            niches: config.niches,
            interestTags: config.interestTags,
            trends: trendsForPick,
            excludeTitles: excludeSoFar,
            usedPillars: [...acceptedPillars],
            usedFormats: [...acceptedFormats],
            assignedPillar,
            currentYear,
            todayIso: today,
            correctionNote: correctionNotes[i],
            instruction,
            recentFeedback: config.recentFeedback,
          });
        } catch (err) {
          console.warn(`[content-calendar] topic selection failed for slot ${i} (round ${round + 1})`, err);
          continue;
        }

        const dup = findNearDuplicate(candidate.topicTitle, excludeSoFar);
        if (dup) {
          rejectionLog.push({ round: round + 1, pillar: assignedPillar, title: candidate.topicTitle, reason: `near-duplicate of "${dup}"` });
          correctionNotes[i] = `"${candidate.topicTitle}" was rejected as a near-duplicate of an existing title — pick a genuinely different angle.`;
          continue;
        }
        const staleYear = findStaleYear(candidate.topicTitle, currentYear);
        if (staleYear) {
          rejectionLog.push({ round: round + 1, pillar: assignedPillar, title: candidate.topicTitle, reason: `stale year ${staleYear} (current year is ${currentYear})` });
          correctionNotes[i] = `"${candidate.topicTitle}" was rejected for citing ${staleYear} — the current year is ${currentYear}. Don't copy a year from a trending source's headline.`;
          continue;
        }
        cleared = candidate;
      }

      if (cleared) {
        roundCandidates.push({ index: i, ...cleared });
      }
      // else: slot stays pending, retried next round (or dropped at the cap)
    }

    if (roundCandidates.length === 0) {
      console.log(`[content-calendar] round ${round + 1}/${MAX_ROUNDS}: 0 candidates cleared deterministic checks, nothing to judge`);
      continue;
    }

    // Phase 2: ONE batched judge call for everything that cleared the
    // deterministic filter this round — bounded LLM cost regardless of how
    // many slots are still pending.
    const verdicts = await judgeCandidates({
      tenantSlug,
      niches: config.niches,
      currentYear,
      candidates: roundCandidates.map((c) => ({ index: c.index, title: c.topicTitle, pillar: c.pillar, format: c.format })),
      contextTitles: [...acceptedTitles, ...roundCandidates.map((c) => c.topicTitle)],
    });

    let acceptedThisRound = 0;
    let rejectedThisRound = 0;
    for (const c of roundCandidates) {
      const verdict = verdicts.find((v) => v.index === c.index);
      if (verdict?.pass) {
        slots[c.index] = { topicTitle: c.topicTitle, searchQuery: c.searchQuery, pillar: c.pillar, format: c.format };
        acceptedTitles.push(c.topicTitle);
        acceptedPillars.push(c.pillar);
        acceptedFormats.push(c.format);
        acceptedThisRound++;
      } else {
        const reason = verdict?.reason || "judge rejected";
        rejectionLog.push({ round: round + 1, pillar: c.pillar, title: c.topicTitle, reason });
        correctionNotes[c.index] = `"${c.topicTitle}" was rejected: ${reason}`;
        rejectedThisRound++;
      }
    }

    console.log(
      `[content-calendar] round ${round + 1}/${MAX_ROUNDS}: ${roundCandidates.length} generated, ${acceptedThisRound} accepted, ${rejectedThisRound} rejected`
    );
  }

  const finalPicks = slots.filter((s): s is TopicCandidate => s !== null);
  const missingPillars = config.niches.filter((niche) => !finalPicks.some((p) => p.pillar === niche));

  if (rejectionLog.length > 0) {
    console.warn(`[content-calendar] batch rejection log (${rejectionLog.length} entries)`, rejectionLog);
  }
  if (missingPillars.length > 0) {
    console.warn(
      `[content-calendar] batch could not cover every pillar within ${MAX_ROUNDS} rounds — missing: ${missingPillars.join(", ")}`
    );
  }

  if (finalPicks.length === 0) {
    return {
      success: false,
      error: "Every candidate this batch failed quality validation — try again, or adjust pillars/interests.",
    };
  }

  // Phase 3: generate briefings for all ACCEPTED topics CONCURRENTLY — no
  // cross-slot dependency here, safe (and fast) to parallelize.
  const results = await mapWithConcurrency(finalPicks, 3, async (pick) => {
    try {
      const brief = await generateBriefing({
        tenantSlug,
        topicTitle: pick.topicTitle,
        searchQuery: pick.searchQuery,
        pillar: pick.pillar,
        format: pick.format,
        instruction,
      });
      return { topicTitle: pick.topicTitle, brief, error: null as string | null };
    } catch (err) {
      return {
        topicTitle: null,
        brief: null,
        error: err instanceof Error ? err.message : "Generation failed",
      };
    }
  });

  const succeeded = results.filter(
    (r): r is { topicTitle: string; brief: NonNullable<typeof r.brief>; error: null } =>
      r.topicTitle !== null && r.brief !== null
  );
  const failedCount = results.length - succeeded.length;

  if (succeeded.length === 0) {
    return { success: false, error: "Generation failed for every slot — try again." };
  }

  const startPosition = await getNextPosition(admin, tenantSlug);
  const startDate = await getNextScheduledDate(admin, tenantSlug);
  const perDay = Math.max(1, config.postsPerDay);
  const rows = succeeded.map((r, i) => ({
    tenant_slug: tenantSlug,
    position: startPosition + i,
    // `postsPerDay` slots land on each day before moving to the next one,
    // continuing forward from wherever the queue currently ends — not a
    // rigid one-per-day spread (some days are for filming multiple,
    // others none).
    scheduled_date: addDays(startDate, Math.floor(i / perDay)),
    status: "assigned",
    topic_title: r.topicTitle,
    topic_brief: r.brief,
    platforms: [],
    created_by: userId,
  }));

  const { error: insertErr } = await admin.from("content_slots").insert(rows);
  if (insertErr) {
    return { success: false, error: insertErr.message };
  }

  revalidatePath("/content-calendar");
  return {
    success: true,
    candidatesFound: trends.length,
    generated: succeeded.length,
    errors: failedCount,
    roundsUsed,
    rejected: rejectionLog,
    missingPillars,
  };
}

export async function regenerateSlot(slotId: string, reason?: string): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };
  const { tenantSlug } = gate;

  const admin = createAdminClient();
  const { data: slot } = await admin
    .from("content_slots")
    .select("id, tenant_slug, topic_brief")
    .eq("id", slotId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (!slot) return { success: false, error: "Slot not found" };

  // Log a stated reason before regenerating — closes the loop for the NEXT
  // pick, not just this one (see recentFeedback in config.ts).
  if (reason && reason.trim()) {
    const currentPillar = (slot.topic_brief as { pillar?: string | null } | null)?.pillar ?? null;
    await appendContentCalendarFeedback(tenantSlug, { reason: reason.trim(), pillar: currentPillar });
  }

  const config = await getContentCalendarConfig(tenantSlug);
  const trendsPerNiche = await Promise.all(config.niches.map((niche) => fetchTrendCandidates(niche)));
  const trends = trendsPerNiche.flat();

  const { data: siblings } = await admin
    .from("content_slots")
    .select("topic_title")
    .eq("tenant_slug", tenantSlug)
    .neq("id", slotId);
  const excludeTitles = (siblings ?? []).map((s) => s.topic_title as string);

  try {
    const { topicTitle, brief } = await generateSlotContent({
      tenantSlug,
      niches: config.niches,
      interestTags: config.interestTags,
      trends,
      excludeTitles,
      currentYear: new Date().getUTCFullYear(),
      todayIso: todayIso(),
      instruction: reason,
      recentFeedback: config.recentFeedback,
    });

    const { error } = await admin
      .from("content_slots")
      .update({
        topic_title: topicTitle,
        topic_brief: brief,
        generated_at: new Date().toISOString(),
        retired_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", slotId);
    if (error) return { success: false, error: error.message };

    revalidatePath("/content-calendar");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Regeneration failed" };
  }
}

export async function updateSlotStatus(
  slotId: string,
  status: "in_progress" | "filmed" | "posted" | "skipped",
  platforms?: string[]
): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };

  const admin = createAdminClient();
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "posted") {
    update.posted_at = new Date().toISOString();
    if (platforms) update.platforms = platforms;
  }

  const { error } = await admin
    .from("content_slots")
    .update(update)
    .eq("id", slotId)
    .eq("tenant_slug", gate.tenantSlug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/content-calendar");
  return { success: true };
}

// Manually move a slot to a different calendar day — e.g. drag-and-drop or
// a date picker in the detail panel. Doesn't touch position/status.
export async function rescheduleSlot(slotId: string, scheduledDate: string): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return { success: false, error: "Invalid date" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("content_slots")
    .update({ scheduled_date: scheduledDate, updated_at: new Date().toISOString() })
    .eq("id", slotId)
    .eq("tenant_slug", gate.tenantSlug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/content-calendar");
  return { success: true };
}

// Direct manual override of the topic title — bypasses the AI entirely,
// for when the founder just wants to retitle what they're filming rather
// than ask the AI to regenerate a new one.
export async function updateSlotTopic(slotId: string, topicTitle: string): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };
  const trimmed = topicTitle.trim();
  if (!trimmed) return { success: false, error: "Topic can't be empty" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("content_slots")
    .update({ topic_title: trimmed, updated_at: new Date().toISOString() })
    .eq("id", slotId)
    .eq("tenant_slug", gate.tenantSlug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/content-calendar");
  return { success: true };
}

export async function updateSlotNotes(slotId: string, notes: string): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("content_slots")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", slotId)
    .eq("tenant_slug", gate.tenantSlug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/content-calendar");
  return { success: true };
}

// Video upload — reuses ONLY the signed-upload-URL mechanism from
// video-generate.ts, not its video_assets table (design doc ENG REVIEW,
// locked decision #5: that table's model is provider-job/credits-shaped
// for AI-rendered clips, a category mismatch for a founder's own
// manually-filmed upload). The reference is stored directly on the slot.
export async function createSignedSlotVideoUpload(
  contentType: string
): Promise<ActionResult<{ key: string; url: string }>> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };
  if (!contentType.startsWith("video/")) {
    return { success: false, error: "Upload a video file" };
  }

  const ext = contentType.split("/")[1] || "mp4";
  const key = `content-calendar/${gate.tenantSlug}/${randomUUID()}.${ext}`;

  try {
    const url = await createR2PresignedPut(key, contentType);
    return { success: true, key, url };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not create upload URL" };
  }
}

export async function registerSlotVideo(slotId: string, key: string): Promise<ActionResult<{ url: string }>> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };
  if (!key.startsWith(`content-calendar/${gate.tenantSlug}/`)) {
    return { success: false, error: "Invalid upload key" };
  }

  const url = r2PublicUrl(key);
  const admin = createAdminClient();
  const { error } = await admin
    .from("content_slots")
    .update({ video_asset_url: url, status: "filmed", updated_at: new Date().toISOString() })
    .eq("id", slotId)
    .eq("tenant_slug", gate.tenantSlug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/content-calendar");
  return { success: true, url };
}

// Raw trending headlines per configured pillar — NO AI call, just the same
// free HN/Serper fetch generateNextBatch already uses, surfaced directly to
// the creator so they can see the landscape themselves before generating
// (senior-uiux audit stage 01: today's flow hands them AI-filtered picks
// with zero visibility into what actually fed them).
export async function getTrendPreview(): Promise<
  ActionResult<{ trends: Array<TrendCandidate & { niche: string }> }>
> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };

  const config = await getContentCalendarConfig(gate.tenantSlug);
  const perNiche = await Promise.all(
    config.niches.map(async (niche) => {
      const trends = await fetchTrendCandidates(niche);
      return trends.map((t) => ({ ...t, niche }));
    })
  );

  return { success: true, trends: perNiche.flat() };
}

// Pins a trend the creator spotted themselves straight onto a specific
// date — bypassing the normal "next available slot in sequence" queue
// placement. Breaking news needs to be talked about on the day it broke,
// not queued behind whatever else is already scheduled. Skips the
// topic-selection AI call entirely (the human already picked the topic) —
// only the briefing call runs, grounded on this exact trend.
export async function createSlotFromTrend(input: {
  title: string;
  url: string;
  niche: string;
  scheduledDate: string;
}): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };
  const { tenantSlug, userId } = gate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) {
    return { success: false, error: "Invalid date" };
  }

  const admin = createAdminClient();
  await retireStaleSlots(admin, tenantSlug);
  const openDepth = await getOpenQueueDepth(admin, tenantSlug);
  if (openDepth >= MAX_QUEUE_DEPTH) {
    return {
      success: false,
      error: `Queue is at its cap (${MAX_QUEUE_DEPTH} open slots) — work through some before adding more.`,
    };
  }

  try {
    const brief = await generateBriefing({
      tenantSlug,
      topicTitle: input.title,
      searchQuery: input.title,
      pillar: input.niche,
    });

    const position = await getNextPosition(admin, tenantSlug);
    const { error } = await admin.from("content_slots").insert({
      tenant_slug: tenantSlug,
      position,
      scheduled_date: input.scheduledDate,
      status: "assigned",
      topic_title: input.title,
      topic_brief: brief,
      platforms: [],
      created_by: userId,
    });
    if (error) return { success: false, error: error.message };

    revalidatePath("/content-calendar");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to add this topic" };
  }
}

// Manually add ONE slot pinned to a specific date, chosen by clicking "+"
// on that day cell — for when the founder already knows they want
// something scheduled there and doesn't want to wait for it to reach the
// front of the normal sequential queue. `instruction` is optional free
// text ("talk about the new EU AI Act") that steers topic selection same
// as the batch-level and regenerate-reason instructions; left blank, it
// behaves like a single ordinary pick from trends/interests.
export async function createSlotForDate(
  scheduledDate: string,
  instruction?: string
): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };
  const { tenantSlug, userId } = gate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return { success: false, error: "Invalid date" };
  }

  const admin = createAdminClient();
  await retireStaleSlots(admin, tenantSlug);
  const openDepth = await getOpenQueueDepth(admin, tenantSlug);
  if (openDepth >= MAX_QUEUE_DEPTH) {
    return {
      success: false,
      error: `Queue is at its cap (${MAX_QUEUE_DEPTH} open slots) — work through some before adding more.`,
    };
  }

  const config = await getContentCalendarConfig(tenantSlug);
  const trendsPerNiche = await Promise.all(config.niches.map((niche) => fetchTrendCandidates(niche)));
  const trends = trendsPerNiche.flat();

  const { data: existingOpenSlots } = await admin
    .from("content_slots")
    .select("topic_title")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"]);
  const excludeTitles = (existingOpenSlots ?? []).map((s) => s.topic_title as string);

  try {
    const { topicTitle, brief } = await generateSlotContent({
      tenantSlug,
      niches: config.niches,
      interestTags: config.interestTags,
      trends,
      excludeTitles,
      currentYear: new Date().getUTCFullYear(),
      todayIso: todayIso(),
      instruction,
      recentFeedback: config.recentFeedback,
    });

    const position = await getNextPosition(admin, tenantSlug);
    const { error } = await admin.from("content_slots").insert({
      tenant_slug: tenantSlug,
      position,
      scheduled_date: scheduledDate,
      status: "assigned",
      topic_title: topicTitle,
      topic_brief: brief,
      platforms: [],
      created_by: userId,
    });
    if (error) return { success: false, error: error.message };

    revalidatePath("/content-calendar");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to add this topic" };
  }
}

// Hard-deletes a slot entirely — distinct from Skip, which keeps a
// (deliberately visible) record on the calendar. Skip is "I chose not to
// do this one"; Delete is "get rid of it, no trace on this date."
export async function deleteSlot(slotId: string): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("content_slots")
    .delete()
    .eq("id", slotId)
    .eq("tenant_slug", gate.tenantSlug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/content-calendar");
  return { success: true };
}

// Called when the founder opens a slot's detail view for the first time —
// fires the assigned → in_progress transition automatically (design doc
// ENG REVIEW: no separate manual button for this).
export async function markSlotOpened(slotId: string): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("content_slots")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", slotId)
    .eq("tenant_slug", gate.tenantSlug)
    .eq("status", "assigned");
  if (error) return { success: false, error: error.message };

  return { success: true };
}
