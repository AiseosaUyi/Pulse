// Slot lifecycle + rollover logic for the individual-persona content
// calendar. Shared by the daily-email cron and server actions (both use
// the admin client, so this takes one as a parameter rather than creating
// its own — no RLS involved here by design, same as other admin-driven
// lifecycle code in this repo).
//
// Rollover has NO stored "scheduled date" to shift — `position` (assigned
// once at creation, never mutated) is the only ordering key. "Next" is
// computed lazily, at read time, as the lowest-position slot still in
// `assigned`/`in_progress` — anything `posted` or `skipped` is naturally
// excluded, so the effective "day" a slot represents is just whichever
// slot is next when opened, not a mutated date column. Worked example
// (flagged as needed by the design doc's adversarial review): positions
// 1-3 posted, 4 skipped, 5 in_progress → next = 5 (1-3 excluded by status,
// 4 excluded by status, 5 is the lowest remaining position).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTO_RETIRE_AFTER_DAYS,
  type ContentSlotRecord,
} from "@/lib/types/content-calendar";

type AdminClient = SupabaseClient;

function rowToSlot(row: Record<string, unknown>): ContentSlotRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    position: row.position as number,
    status: row.status as ContentSlotRecord["status"],
    topicTitle: row.topic_title as string,
    topicBrief: (row.topic_brief as ContentSlotRecord["topicBrief"]) ?? {
      talkingPoints: [],
      stat: null,
      statSourceUrl: null,
      contrarianAngle: null,
      referenceLinks: [],
      noReferencesFound: true,
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

export async function getNextUnpostedSlot(
  admin: AdminClient,
  tenantSlug: string
): Promise<ContentSlotRecord | null> {
  await retireStaleSlots(admin, tenantSlug);

  const { data, error } = await admin
    .from("content_slots")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["assigned", "in_progress"])
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
  await retireStaleSlots(admin, tenantSlug);

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

export { rowToSlot };
