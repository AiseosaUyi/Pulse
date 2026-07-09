"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";
import { getContentCalendarConfig, appendContentCalendarFeedback } from "@/lib/content-calendar/config";
import { fetchTrendCandidates, type TrendCandidate } from "@/lib/scrape/trend-pull";
import { generateSlotContent, selectTopic, generateBriefing } from "@/lib/ai/content-calendar";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import {
  getNextPosition,
  getNextScheduledDate,
  getOpenQueueDepth,
  retireStaleSlots,
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
export async function generateNextBatch(
  requestedN: number,
  instruction?: string
): Promise<ActionResult<{ candidatesFound: number; generated: number; errors: number }>> {
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

  // Fetched ONCE per pillar, shared across all N slots (locked decision
  // #4) — not re-fetched per slot. Fetched per-pillar (not one blended
  // query) so a batch's trend pool actually has candidates for every
  // pillar, not just whichever single niche string used to dominate.
  const trendsPerNiche = await Promise.all(config.niches.map((niche) => fetchTrendCandidates(niche)));
  const trends = trendsPerNiche.flat();
  if (trends.length === 0 && config.interestTags.length === 0) {
    return {
      success: false,
      error:
        "Couldn't find any trends and no interest tags are configured — nothing to generate from. Add interest tags in settings or try again later.",
    };
  }

  // Dedup: seeded with titles (and pillars, for rotation) already in the
  // open queue from a PRIOR batch call — confirmed live (2026-07-09):
  // without this, two separate "Generate my next N" calls produced
  // duplicate copies of the same topics, since in-batch-only dedup has no
  // memory of what a previous batch already picked.
  const { data: existingOpenSlots } = await admin
    .from("content_slots")
    .select("topic_title, topic_brief")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"]);
  const pickedTitles: string[] = (existingOpenSlots ?? []).map((s) => s.topic_title as string);
  const usedPillars: string[] = (existingOpenSlots ?? [])
    .map((s) => (s.topic_brief as { pillar?: string | null } | null)?.pillar)
    .filter((p): p is string => !!p);

  // Phase 1: pick all N topics SEQUENTIALLY (not concurrently). This is
  // deliberate, not an oversight — confirmed live (2026-07-09): with
  // concurrency, multiple topic-selection calls fire in parallel before
  // any of them can see each other's pick, so the exclude list is stale
  // for all but the first, and duplicate/rephrased topics slip through
  // (3 of 5 slots in one real batch were the same story rephrased 3
  // ways). Cheap to do sequentially — "scoring" tier, ~1-3s each.
  const picks: Array<{ topicTitle: string; searchQuery: string; pillar: string } | null> = [];
  for (let i = 0; i < n; i++) {
    try {
      const pick = await selectTopic({
        tenantSlug,
        niches: config.niches,
        interestTags: config.interestTags,
        trends,
        excludeTitles: [...pickedTitles],
        usedPillars: [...usedPillars],
        instruction,
        recentFeedback: config.recentFeedback,
      });
      pickedTitles.push(pick.topicTitle);
      usedPillars.push(pick.pillar);
      picks.push(pick);
    } catch (err) {
      console.warn("[content-calendar] topic selection failed for one slot", err);
      picks.push(null);
    }
  }

  // Phase 2: generate briefings for all selected topics CONCURRENTLY — no
  // cross-slot dependency here, safe (and fast) to parallelize.
  const results = await mapWithConcurrency(picks, 3, async (pick) => {
    if (!pick) return { topicTitle: null, brief: null, error: "Topic selection failed" };
    try {
      const brief = await generateBriefing({
        tenantSlug,
        topicTitle: pick.topicTitle,
        searchQuery: pick.searchQuery,
        pillar: pick.pillar,
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
