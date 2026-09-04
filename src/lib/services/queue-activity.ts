// Queue activity log (migration 106) — who opened/copied/resolved a queue
// row, when, and what it said at the time. Owner/admin-only read, per
// migration 106's RLS; write is any tenant member logging their own action.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueSource } from "@/lib/services/action-queue";

export type QueueActivityAction = "opened" | "copied_reply" | "resolved" | "reopened" | "dismissed" | "snoozed";

export interface QueueActivityEntry {
  id: string;
  rowSource: QueueSource;
  rowId: string;
  action: QueueActivityAction;
  actorId: string | null;
  actorName: string | null;
  contentSnapshot: string | null;
  createdAt: string;
}

export async function logQueueActivity(
  client: SupabaseClient,
  tenantSlug: string,
  input: {
    rowSource: QueueSource;
    rowId: string;
    action: QueueActivityAction;
    actorId: string;
    contentSnapshot?: string | null;
    meta?: Record<string, unknown>;
  }
): Promise<void> {
  // Best-effort — a failure to log must never block the underlying action
  // (opening a link, copying text, resolving a row) that triggered it.
  await client.from("queue_activity_log").insert({
    tenant_slug: tenantSlug,
    row_source: input.rowSource,
    row_id: input.rowId,
    action: input.action,
    actor_id: input.actorId,
    content_snapshot: input.contentSnapshot ?? null,
    meta: input.meta ?? {},
  });
}

/** Owner/admin only — RLS enforces this, but the session-scoped client is
 * required (an admin client would bypass the read restriction entirely). */
export async function listQueueActivityForRow(
  client: SupabaseClient,
  tenantSlug: string,
  rowSource: QueueSource,
  rowId: string,
  limit = 20
): Promise<QueueActivityEntry[]> {
  const { data, error } = await client
    .from("queue_activity_log")
    .select("id, row_source, row_id, action, actor_id, content_snapshot, created_at")
    .eq("tenant_slug", tenantSlug)
    .eq("row_source", rowSource)
    .eq("row_id", rowId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  // Manual join, not an embedded select — queue_activity_log.actor_id and
  // profiles.id both reference auth.users(id) independently, so PostgREST
  // can't infer a direct embed path between the two. Same pattern
  // listTenantMembers() uses for the same reason.
  const actorIds = [...new Set(data.map((r) => r.actor_id as string | null).filter(Boolean))] as string[];
  const nameMap = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data: profiles } = await client.from("profiles").select("id, display_name").in("id", actorIds);
    for (const p of profiles ?? []) nameMap.set(p.id as string, p.display_name as string | null);
  }

  return data.map((row) => ({
    id: row.id as string,
    rowSource: row.row_source as QueueSource,
    rowId: row.row_id as string,
    action: row.action as QueueActivityAction,
    actorId: (row.actor_id as string | null) ?? null,
    actorName: row.actor_id ? (nameMap.get(row.actor_id as string) ?? null) : null,
    contentSnapshot: (row.content_snapshot as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}
