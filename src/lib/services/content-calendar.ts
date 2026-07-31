import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToSlot, getNextPosition, getNextScheduledDate, retireStaleSlots, todayIso } from "@/lib/services/content-calendar-lifecycle";
import { getContentCalendarConfig } from "@/lib/content-calendar/config";
import { buildPillarAssignments } from "@/lib/content-calendar/pillar-rotation";
import { fetchTrendCandidates } from "@/lib/scrape/trend-pull";
import { selectTopic, selectTopicsBatch, generateBriefing, ContentCalendarAiError } from "@/lib/ai/content-calendar";
import { checkAiBudget, BudgetExceededError } from "@/lib/ai/ai-budget";
import { judgeCandidates } from "@/lib/ai/content-calendar-judge";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { findNearDuplicate } from "@/lib/utils/text-similarity";
import { findStaleYear } from "@/lib/utils/year-check";
import { MAX_BATCH_SIZE, type ContentSlotRecord } from "@/lib/types/content-calendar";

// Read path for the queue-view page — uses the RLS-respecting server
// client (is_tenant_member policy), same convention as other page-level
// service reads. Staleness auto-retire is a write, so it happens via the
// admin-client lifecycle helpers (called from the page/action layer, not
// here) — this function is a pure read.
export async function listContentSlots(
  tenantSlug: string
): Promise<ContentSlotRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_slots")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("position", { ascending: true });

  if (error || !data) return [];
  return data.map(rowToSlot);
}

/** Client-injected twin for /api/v1 + MCP. Callers must run
 * rolloverOverdueSlots(admin, tenantSlug) first if "upcoming" should
 * reflect today's rolled-forward dates — this function is a pure read,
 * same as listContentSlots(). */
export async function listContentSlotsApi(
  client: SupabaseClient,
  tenantSlug: string
): Promise<ContentSlotRecord[]> {
  const { data, error } = await client
    .from("content_slots")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("position", { ascending: true });
  if (error || !data) return [];
  return data.map(rowToSlot);
}

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

export interface BatchRejection {
  round: number;
  pillar: string;
  title: string;
  reason: string;
}

export type GenerateNextBatchResult =
  | {
      success: true;
      candidatesFound: number;
      generated: number;
      errors: number;
      roundsUsed: number;
      rejected: BatchRejection[];
      missingPillars: string[];
    }
  | { success: false; error: string };

// Client-injected twin of generateNextBatch (actions/content-calendar.ts),
// for /api/v1 + MCP callers — same reason as listContentSlotsApi: those
// callers are authenticated by a bearer token via requireApiContext, not a
// browser cookie session, so they can't go through requireUser()/
// getCurrentTenant() (both redirect()/return-null without a session — see
// the "Service-role callers fail membership-gated RPCs" pattern in
// CLAUDE.md for the general shape of this gotcha). tenantSlug/userId are
// resolved by the CALLER from its own auth context and passed in directly
// — this function trusts them, same as every other *Api service function.
//
// Runs synchronously (no durable-runner tables — design doc ENG REVIEW,
// locked decision #1/#6): N is capped, concurrency-limited, and the caller
// (Server Action route or /api/v1 route) should set an explicit
// maxDuration sized to real measured per-slot latency.
//
// Self-correcting loop: generate → validate against the full quality
// rubric (uniqueness, current year, on-lane + individual-brand fit,
// format/skeleton variety) → regenerate ONLY the slots that failed, telling
// the model exactly why → repeat, up to MAX_ROUNDS. A slot that still can't
// pass by the cap is DROPPED, not padded with a failing candidate — the
// batch yields fewer than N with the reason surfaced, rather than silently
// shipping junk.
export async function generateNextBatchApi(
  admin: SupabaseClient,
  tenantSlug: string,
  userId: string | null,
  requestedN: number,
  instruction?: string
): Promise<GenerateNextBatchResult> {
  const startedAt = Date.now();
  console.log(`[content-calendar] generateNextBatchApi start — tenant=${tenantSlug} requestedN=${requestedN} instruction=${instruction ? `"${instruction}"` : "(none)"}`);

  // Cost-based backpressure — not a queue-depth cap (that was deliberately
  // removed twice, see MAX_QUEUE_DEPTH history: a hardcoded slot count kept
  // being wrong in one direction or the other). This gates actual AI spend
  // instead, via the same monthly-budget mechanism already used by the SEO
  // module (src/lib/ai/ai-budget.ts) — nothing previously stopped repeated
  // batch calls (web UI or the rate-limited-but-not-cost-limited /api/v1
  // route) from generating unbounded AI spend.
  try {
    await checkAiBudget(tenantSlug);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  await retireStaleSlots(admin, tenantSlug);

  const n = Math.max(1, Math.min(requestedN, MAX_BATCH_SIZE));
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

  console.log(
    `[content-calendar] config loaded — tenant=${tenantSlug} niches=${config.niches.length} interestTags=${config.interestTags.length} trends=${trends.length} postsPerDay=${config.postsPerDay}`
  );

  if (trends.length === 0 && config.interestTags.length === 0) {
    console.warn(`[content-calendar] generateNextBatchApi aborted — no trends and no interest tags — tenant=${tenantSlug}`);
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
    const pendingIndices: number[] = [];
    slots.forEach((s, i) => { if (s === null) pendingIndices.push(i); });
    if (pendingIndices.length === 0) break;
    roundsUsed = round + 1;

    // Phase 1: generate ALL candidates for still-pending slots in one batched LLM call
    // (a 10x speedup over the previous sequential O(N) calls). The batched call is instructed
    // to naturally avoid duplicates across the generated array, solving the concurrency issue
    // that originally forced sequential execution.
    // Cheap deterministic checks (near-duplicate, stale year) run inline, for free,
    // before a candidate is even worth spending a judge call on.
    const roundCandidates: Array<TopicCandidate & { index: number }> = [];
    
    // Gather all assigned pillars and correction notes for this batch request
    const batchAssignedPillars = pendingIndices.map((i) => pillarAssignments[i]);
    const batchCorrectionNotes = pendingIndices.map((i) => correctionNotes[i]);
    const excludeSoFar = [...acceptedTitles];

    let batchCandidates: Array<{ topicTitle: string; searchQuery: string; pillar: string; format: any }> = [];
    let batchTimedOut = false;
    try {
      batchCandidates = await selectTopicsBatch({
        tenantSlug,
        niches: config.niches,
        interestTags: config.interestTags,
        trends, // Pass all trends pool
        excludeTitles: excludeSoFar,
        usedPillars: [...acceptedPillars],
        usedFormats: [...acceptedFormats],
        assignedPillars: batchAssignedPillars,
        currentYear,
        todayIso: today,
        correctionNotes: batchCorrectionNotes,
        instruction,
        recentFeedback: config.recentFeedback,
      });
    } catch (err) {
      // ContentCalendarAiError wraps the real cause — unwrap it so a
      // transient validation/rate-limit/network error isn't treated the
      // same as an actual timeout. Matches the AI SDK's own isAbortError
      // check (@ai-sdk/provider-utils): AbortError / ResponseAborted /
      // TimeoutError name on an Error or DOMException.
      const cause = err instanceof ContentCalendarAiError ? err.cause : err;
      const isTimeout =
        (cause instanceof Error || cause instanceof DOMException) &&
        (cause.name === "AbortError" || cause.name === "ResponseAborted" || cause.name === "TimeoutError");

      if (isTimeout) {
        console.warn(`[content-calendar] batched topic selection timed out (round ${round + 1}) — further rounds would also time out, stopping early`, err);
        batchTimedOut = true;
      } else {
        // Not a timeout — this round is bounded by MAX_ROUNDS regardless,
        // so give the loop a chance to recover on the next round instead of
        // discarding the rest of the batch on one transient failure.
        console.warn(`[content-calendar] batched topic selection failed (round ${round + 1}), will retry next round`, err);
        continue;
      }
    }
    if (batchTimedOut) break;

    // Process each candidate returned by the batch call through deterministic checks
    for (let batchIdx = 0; batchIdx < batchCandidates.length; batchIdx++) {
      const candidate = batchCandidates[batchIdx];
      const slotIndex = pendingIndices[batchIdx];
      const assignedPillar = pillarAssignments[slotIndex];
      
      const dup = findNearDuplicate(candidate.topicTitle, excludeSoFar);
      if (dup) {
        rejectionLog.push({ round: round + 1, pillar: assignedPillar, title: candidate.topicTitle, reason: `near-duplicate of "${dup}"` });
        correctionNotes[slotIndex] = `"${candidate.topicTitle}" was rejected as a near-duplicate of an existing title — pick a genuinely different angle.`;
        continue;
      }
      
      const staleYear = findStaleYear(candidate.topicTitle, currentYear);
      if (staleYear) {
        rejectionLog.push({ round: round + 1, pillar: assignedPillar, title: candidate.topicTitle, reason: `stale year ${staleYear} (current year is ${currentYear})` });
        correctionNotes[slotIndex] = `"${candidate.topicTitle}" was rejected for citing ${staleYear} — the current year is ${currentYear}. Don't copy a year from a trending source's headline.`;
        continue;
      }

      // Passed deterministic checks
      excludeSoFar.push(candidate.topicTitle);
      roundCandidates.push({ index: slotIndex, ...candidate });
    }

    if (roundCandidates.length === 0) {
      console.log(`[content-calendar] round ${round + 1}/${MAX_ROUNDS}: 0 candidates cleared deterministic checks, nothing to judge`);
      continue;
    }

    // Short-circuit: if all slots are already filled (e.g. some were
    // accepted in this round and there are no more pending), skip judging
    // and exit immediately — the loop condition will catch it on next
    // iteration but this avoids an unnecessary judge LLM call.
    if (slots.every((s) => s !== null)) break;

    // Phase 2: ONE batched judge call for everything that cleared the
    // deterministic filter this round — bounded LLM cost regardless of how
    // many slots are still pending.
    const verdicts = await judgeCandidates({
      tenantSlug,
      niches: config.niches,
      currentYear,
      candidates: roundCandidates.map((c) => ({ index: c.index, title: c.topicTitle, pillar: c.pillar, format: c.format })),
      contextTitles: [...acceptedTitles],
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

  console.log(
    `[content-calendar] rounds complete — tenant=${tenantSlug} roundsUsed=${roundsUsed} finalPicks=${finalPicks.length}/${n} missingPillars=[${missingPillars.join(", ")}]`
  );
  if (rejectionLog.length > 0) {
    console.warn(`[content-calendar] batch rejection log (${rejectionLog.length} entries)`, rejectionLog);
  }

  if (finalPicks.length === 0) {
    console.error(`[content-calendar] generateNextBatchApi failed — every candidate rejected — tenant=${tenantSlug} durationMs=${Date.now() - startedAt}`);
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
  console.log(`[content-calendar] briefings generated — tenant=${tenantSlug} succeeded=${succeeded.length} failed=${failedCount}`);

  if (succeeded.length === 0) {
    console.error(`[content-calendar] generateNextBatchApi failed — every briefing failed — tenant=${tenantSlug} durationMs=${Date.now() - startedAt}`);
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

  console.log(`[content-calendar] inserting rows — tenant=${tenantSlug} rowCount=${rows.length}`);
  const { error: insertErr } = await admin.from("content_slots").insert(rows);
  if (insertErr) {
    console.error(`[content-calendar] insert failed — tenant=${tenantSlug} error=${insertErr.message}`);
    return { success: false, error: insertErr.message };
  }
  console.log(`[content-calendar] insert succeeded — tenant=${tenantSlug} rowCount=${rows.length}`);

  const durationMs = Date.now() - startedAt;
  console.log(
    `[content-calendar] generateNextBatchApi end — tenant=${tenantSlug} generated=${succeeded.length} errors=${failedCount} roundsUsed=${roundsUsed} durationMs=${durationMs}`
  );

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
