// Stale queue cleanup: hide, never delete. An item that is still open and
// that nobody touched for 30 days moves to status 'archived' and gets an
// audit row in queue_activity_log. It stays in the database and shows under
// Archived, where anyone can reopen it.
//
// Only action_items and engagement_items allow 'archived' (migrations 108,
// 114). inbound_messages only allows open/snoozed/resolved/dismissed, so it
// is left alone. Resolved, dismissed, handed-off, snoozed and replied rows are
// never selected: the query only takes status = 'open'.
//
// Runs with the admin client (cron), so every query is scoped by tenant_slug.

import type { SupabaseClient } from "@supabase/supabase-js";

export const STALE_DAYS = 30;
const PER_TABLE_LIMIT = 500;
const CHUNK = 100;

export type StaleTable = "action_items" | "engagement_items";

export interface StaleItem {
  table: StaleTable;
  id: string;
  title: string;
  updatedAt: string;
}

export interface ArchiveResult {
  archived: number;
  error?: string;
}

const ROW_SOURCE: Record<StaleTable, "action" | "engagement"> = {
  action_items: "action",
  engagement_items: "engagement",
};

export function staleCutoff(now: Date, days = STALE_DAYS): string {
  return new Date(now.getTime() - days * 86400000).toISOString();
}

/** Pure check, shared by the query filter below and the tests. */
export function isStale(
  row: { status?: unknown; updated_at?: unknown; snoozed_until?: unknown; replied?: unknown },
  now: Date,
  days = STALE_DAYS
): boolean {
  if (row.status !== "open") return false;
  if (row.replied === true) return false;
  if (typeof row.updated_at !== "string") return false;
  if (row.updated_at >= staleCutoff(now, days)) return false;
  // A snooze still in the future means someone parked it on purpose.
  if (typeof row.snoozed_until === "string" && new Date(row.snoozed_until).getTime() > now.getTime()) return false;
  return true;
}

export async function selectStaleItems(
  client: SupabaseClient,
  tenantSlug: string,
  now = new Date()
): Promise<StaleItem[]> {
  const cutoff = staleCutoff(now);
  const [actions, engagement] = await Promise.all([
    client
      .from("action_items")
      .select("id, status, title, updated_at, snoozed_until")
      .eq("tenant_slug", tenantSlug)
      .eq("status", "open")
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(PER_TABLE_LIMIT),
    client
      .from("engagement_items")
      .select("id, status, body, content, from_handle, replied, updated_at, snoozed_until")
      .eq("tenant_slug", tenantSlug)
      .eq("status", "open")
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(PER_TABLE_LIMIT),
  ]);
  if (actions.error) throw new Error(`action_items: ${actions.error.message}`);
  if (engagement.error) throw new Error(`engagement_items: ${engagement.error.message}`);

  const out: StaleItem[] = [];
  for (const r of (actions.data ?? []) as Record<string, unknown>[]) {
    if (!isStale(r, now)) continue;
    out.push({ table: "action_items", id: r.id as string, title: (r.title as string) ?? "", updatedAt: r.updated_at as string });
  }
  for (const r of (engagement.data ?? []) as Record<string, unknown>[]) {
    if (!isStale(r, now)) continue;
    const text = (r.body as string | null) ?? (r.content as string | null) ?? "";
    const who = r.from_handle ? `@${r.from_handle}: ` : "";
    out.push({ table: "engagement_items", id: r.id as string, title: `${who}${text}`, updatedAt: r.updated_at as string });
  }
  return out;
}

/**
 * Writes the audit rows first, then archives. If the audit write fails (for
 * example migration 118 is not applied yet), nothing is archived, so there is
 * never an archived row without its audit trail.
 */
export async function archiveStaleItems(
  client: SupabaseClient,
  tenantSlug: string,
  items: StaleItem[],
  now = new Date()
): Promise<ArchiveResult> {
  let archived = 0;
  for (const table of ["action_items", "engagement_items"] as const) {
    const rows = items.filter((i) => i.table === table);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error: logError } = await client.from("queue_activity_log").insert(
        chunk.map((item) => ({
          tenant_slug: tenantSlug,
          row_source: ROW_SOURCE[table],
          row_id: item.id,
          action: "archived",
          actor_id: null,
          content_snapshot: item.title.slice(0, 500),
          meta: {
            reason: `no activity for ${STALE_DAYS} days`,
            previous_status: "open",
            last_updated_at: item.updatedAt,
            by: "cron:queue-nudge",
            at: now.toISOString(),
          },
        }))
      );
      if (logError) return { archived, error: `audit log: ${logError.message}` };

      // Same field shape setQueueStatus writes for 'archived' (see
      // applyStatusConsistency): engagement rows keep replied=false and no
      // resolved_at, and any old snooze is cleared.
      const patch: Record<string, unknown> =
        table === "engagement_items"
          ? { status: "archived", replied: false, resolved_at: null, snoozed_until: null }
          : { status: "archived", snoozed_until: null };

      const { data, error } = await client
        .from(table)
        .update(patch)
        .eq("tenant_slug", tenantSlug)
        .eq("status", "open") // never flip a row someone changed meanwhile
        .in(
          "id",
          chunk.map((c) => c.id)
        )
        .select("id");
      if (error) return { archived, error: `${table}: ${error.message}` };
      archived += (data ?? []).length;
    }
  }
  return { archived };
}
