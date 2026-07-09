"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";
import { getContentCalendarConfig } from "@/lib/content-calendar/config";
import { fetchTrendCandidates } from "@/lib/scrape/trend-pull";
import { generateSlotContent } from "@/lib/ai/content-calendar";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import {
  getNextPosition,
  getOpenQueueDepth,
  retireStaleSlots,
} from "@/lib/services/content-calendar-lifecycle";
import { MAX_BATCH_SIZE, MAX_QUEUE_DEPTH } from "@/lib/types/content-calendar";
import { createR2PresignedPut, r2PublicUrl } from "@/lib/storage/r2";
import { randomUUID } from "crypto";

type ActionResult<T = unknown> =
  | ({ success: true } & T)
  | { success: false; error: string };

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
  requestedN: number
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

  // Fetched ONCE, shared across all N slots (locked decision #4) — not
  // re-fetched per slot.
  const trends = await fetchTrendCandidates(config.niche);
  if (trends.length === 0 && config.interestTags.length === 0) {
    return {
      success: false,
      error:
        "Couldn't find any trends and no interest tags are configured — nothing to generate from. Add interest tags in settings or try again later.",
    };
  }

  // In-batch dedup: each slot's topic-selection call excludes titles
  // already picked earlier in THIS batch (locked decision from the
  // cross-model review — a single shared trend pull risks repetition
  // otherwise). Accumulated as slots complete, in position order, so
  // concurrency doesn't race the exclude list non-deterministically in a
  // way that matters (best-effort dedup, not a hard guarantee across
  // concurrent slots — acceptable for a personal-use queue of this size).
  // Seeded with titles already in the open queue from a PRIOR batch call —
  // confirmed live (2026-07-09): without this, two separate "Generate my
  // next N" calls produced 3 duplicate copies of the same two topics,
  // since in-batch-only dedup has no memory of what a previous batch
  // already picked.
  const { data: existingOpenSlots } = await admin
    .from("content_slots")
    .select("topic_title")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"]);
  const pickedTitles: string[] = (existingOpenSlots ?? []).map((s) => s.topic_title as string);

  const results = await mapWithConcurrency(
    Array.from({ length: n }, (_, i) => i),
    3,
    async () => {
      try {
        const { topicTitle, brief } = await generateSlotContent({
          tenantSlug,
          niche: config.niche,
          interestTags: config.interestTags,
          trends,
          excludeTitles: [...pickedTitles],
        });
        pickedTitles.push(topicTitle);
        return { topicTitle, brief, error: null as string | null };
      } catch (err) {
        return {
          topicTitle: null,
          brief: null,
          error: err instanceof Error ? err.message : "Generation failed",
        };
      }
    }
  );

  const succeeded = results.filter(
    (r): r is { topicTitle: string; brief: NonNullable<typeof r.brief>; error: null } =>
      r.topicTitle !== null && r.brief !== null
  );
  const failedCount = results.length - succeeded.length;

  if (succeeded.length === 0) {
    return { success: false, error: "Generation failed for every slot — try again." };
  }

  const startPosition = await getNextPosition(admin, tenantSlug);
  const rows = succeeded.map((r, i) => ({
    tenant_slug: tenantSlug,
    position: startPosition + i,
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

export async function regenerateSlot(slotId: string): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };
  const { tenantSlug } = gate;

  const admin = createAdminClient();
  const { data: slot } = await admin
    .from("content_slots")
    .select("id, tenant_slug")
    .eq("id", slotId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (!slot) return { success: false, error: "Slot not found" };

  const config = await getContentCalendarConfig(tenantSlug);
  const trends = await fetchTrendCandidates(config.niche);

  const { data: siblings } = await admin
    .from("content_slots")
    .select("topic_title")
    .eq("tenant_slug", tenantSlug)
    .neq("id", slotId);
  const excludeTitles = (siblings ?? []).map((s) => s.topic_title as string);

  try {
    const { topicTitle, brief } = await generateSlotContent({
      tenantSlug,
      niche: config.niche,
      interestTags: config.interestTags,
      trends,
      excludeTitles,
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
