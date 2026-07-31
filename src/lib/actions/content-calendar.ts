"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";
import { getContentCalendarConfig, appendContentCalendarFeedback } from "@/lib/content-calendar/config";
import { fetchTrendCandidates, type TrendCandidate } from "@/lib/scrape/trend-pull";
import { generateSlotContent, generateBriefing } from "@/lib/ai/content-calendar";
import { generateNextBatchApi, type GenerateNextBatchResult } from "@/lib/services/content-calendar";
import { checkAiBudget, BudgetExceededError } from "@/lib/ai/ai-budget";
import {
  getNextPosition,
  retireStaleSlots,
  todayIso,
} from "@/lib/services/content-calendar-lifecycle";
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

// Thin cookie-authed wrapper around generateNextBatchApi (services/
// content-calendar.ts), which holds the actual self-correcting generation
// loop — kept there (not here) so /api/v1/content-calendar's POST handler
// can call the same logic with a tenantSlug/userId resolved from a bearer
// token instead of a browser session (this action's requireEnabledTenant()
// gate depends on cookies via requireUser()/getCurrentTenant(), neither of
// which resolves anything for a server-to-server API call).
export async function generateNextBatch(
  requestedN: number,
  instruction?: string
): Promise<ActionResult<Extract<GenerateNextBatchResult, { success: true }>>> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };

  const admin = createAdminClient();
  const result = await generateNextBatchApi(admin, gate.tenantSlug, gate.userId, requestedN, instruction);
  if (result.success) revalidatePath("/content-calendar");
  return result;
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

export async function updateSlotDetails(
  slotId: string,
  updates: {
    topicTitle?: string;
    notes?: string;
    category?: string | null;
    whyItMatters?: string;
    talkingPoints?: string[];
    contrarianAngle?: string | null;
  }
): Promise<ActionResult> {
  const gate = await requireEnabledTenant();
  if (!gate.ok) return { success: false, error: gate.error };

  const admin = createAdminClient();
  const { data: slot } = await admin
    .from("content_slots")
    .select("topic_title, notes, topic_brief")
    .eq("id", slotId)
    .eq("tenant_slug", gate.tenantSlug)
    .maybeSingle();

  if (!slot) return { success: false, error: "Slot not found" };

  const currentBrief = (slot.topic_brief as Record<string, unknown> | null) ?? {};
  const updatedBrief = {
    ...currentBrief,
    ...(updates.category !== undefined ? { category: updates.category } : {}),
    ...(updates.whyItMatters !== undefined ? { whyItMatters: updates.whyItMatters } : {}),
    ...(updates.talkingPoints !== undefined ? { talkingPoints: updates.talkingPoints } : {}),
    ...(updates.contrarianAngle !== undefined ? { contrarianAngle: updates.contrarianAngle } : {}),
  };

  const dbUpdate: Record<string, unknown> = {
    topic_brief: updatedBrief,
    updated_at: new Date().toISOString(),
  };

  if (updates.topicTitle !== undefined) {
    const trimmed = updates.topicTitle.trim();
    if (!trimmed) return { success: false, error: "Topic title cannot be empty" };
    dbUpdate.topic_title = trimmed;
  }

  if (updates.notes !== undefined) {
    dbUpdate.notes = updates.notes;
  }

  const { error } = await admin
    .from("content_slots")
    .update(dbUpdate)
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

  try {
    // Cost-based backpressure — see generateNextBatchApi for why this
    // replaces the removed queue-depth cap. err.message is already a
    // clean user-facing string on BudgetExceededError.
    await checkAiBudget(tenantSlug);

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

  // Cost-based backpressure — see generateNextBatchApi for why this
  // replaces the removed queue-depth cap. Checked before any other work
  // (including the trend fetch below) so a budget-exhausted tenant fails
  // fast rather than paying for scraping it won't use.
  try {
    await checkAiBudget(tenantSlug);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return { success: false, error: err.message };
    }
    throw err;
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
