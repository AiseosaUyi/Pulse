// Slot lifecycle + rollover logic for the individual-persona content
// calendar. Shared by the daily-email cron and server actions (both use
// the admin client, so this takes one as a parameter rather than creating
// its own — no RLS involved here by design, same as other admin-driven
// lifecycle code in this repo).
//
// `scheduled_date` is provisional, not fixed (migration 087): any slot
// still `assigned`/`in_progress` whose date has passed rolls forward to
// today automatically — computed lazily on any read path that needs an
// up-to-date queue, not via a separate cron. `position` stays as the
// stable secondary sort key for ordering multiple slots on the same day.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTO_RETIRE_AFTER_DAYS,
  type ContentSlotRecord,
} from "@/lib/types/content-calendar";

type AdminClient = SupabaseClient;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function rowToSlot(row: Record<string, unknown>): ContentSlotRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    position: row.position as number,
    scheduledDate: row.scheduled_date as string,
    status: row.status as ContentSlotRecord["status"],
    topicTitle: row.topic_title as string,
    // Merge with defaults (not just `?? {}`) so slots generated before a
    // brief field existed — e.g. creatorExamples, added 2026-07-09 — don't
    // render as undefined.
    topicBrief: {
      whyItMatters: "",
      talkingPoints: [],
      stat: null,
      statSourceUrl: null,
      contrarianAngle: null,
      referenceLinks: [],
      noReferencesFound: true,
      creatorExamples: [],
      noCreatorExamplesFound: true,
      pillar: null,
      ...((row.topic_brief as Partial<ContentSlotRecord["topicBrief"]>) ?? {}),
    },
    notes: (row.notes as string) ?? null,
    videoAssetUrl: (row.video_asset_url as string) ?? null,
    platforms: (row.platforms as string[]) ?? [],
    retiredReason: (row.retired_reason as string) ?? null,
    generatedAt: row.generated_at as string,
    postedAt: (row.posted_at as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// Auto-retires slots that have sat unposted/unfilmed past the grace
// window (locked decision #13 — queue backpressure). Idempotent, safe to
// call on every read path that needs an up-to-date queue.
export async function retireStaleSlots(
  admin: AdminClient,
  tenantSlug: string
): Promise<void> {
  const cutoff = new Date(
    Date.now() - AUTO_RETIRE_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  await admin
    .from("content_slots")
    .update({ status: "skipped", retired_reason: "stale_auto_retired" })
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"])
    .lt("generated_at", cutoff);
}

// Bumps any open slot whose scheduled_date has already passed forward to
// today — the literal "date rollover" the design doc's adversarial review
// asked for a concrete algorithm for. Idempotent; safe to call on every
// read path (mirrors retireStaleSlots).
export async function rolloverOverdueSlots(
  admin: AdminClient,
  tenantSlug: string
): Promise<void> {
  await admin
    .from("content_slots")
    .update({ scheduled_date: todayIso() })
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"])
    .lt("scheduled_date", todayIso());
}

async function syncQueue(admin: AdminClient, tenantSlug: string): Promise<void> {
  await retireStaleSlots(admin, tenantSlug);
  await rolloverOverdueSlots(admin, tenantSlug);
}

export async function getNextUnpostedSlot(
  admin: AdminClient,
  tenantSlug: string
): Promise<ContentSlotRecord | null> {
  await syncQueue(admin, tenantSlug);

  const { data, error } = await admin
    .from("content_slots")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"])
    .order("scheduled_date", { ascending: true })
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return rowToSlot(data);
}

export async function getOpenQueueDepth(
  admin: AdminClient,
  tenantSlug: string
): Promise<number> {
  await syncQueue(admin, tenantSlug);

  const { count } = await admin
    .from("content_slots")
    .select("id", { count: "exact", head: true })
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"]);

  return count ?? 0;
}

export async function getNextPosition(
  admin: AdminClient,
  tenantSlug: string
): Promise<number> {
  const { data } = await admin
    .from("content_slots")
    .select("position")
    .eq("tenant_slug", tenantSlug)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  return ((data?.position as number) ?? 0) + 1;
}

// Next available calendar date for a freshly generated batch — continues
// forward from the latest already-scheduled OPEN slot (so a new batch
// fills the days right after wherever the queue currently ends), or today
// if the queue is empty.
export async function getNextScheduledDate(
  admin: AdminClient,
  tenantSlug: string
): Promise<string> {
  await syncQueue(admin, tenantSlug);

  const { data } = await admin
    .from("content_slots")
    .select("scheduled_date")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"])
    .order("scheduled_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latest = data?.scheduled_date as string | undefined;
  if (!latest) return todayIso();

  const next = new Date(`${latest}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const today = todayIso();
  const nextIso = next.toISOString().slice(0, 10);
  return nextIso > today ? nextIso : today;
}

export { rowToSlot, todayIso };
