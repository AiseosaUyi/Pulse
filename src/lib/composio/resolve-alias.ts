import { createAdminClient } from "@/lib/supabase/admin";
import type { Alias, Toolkit } from "@/lib/composio/client";

// Resolves which Composio alias to use for a given (tenant, toolkit).
// Returns null when no active connection exists for that pair — callers
// must branch (fall back to Ayrshare for publishing, or surface a
// "connect your account" prompt to the user).

export interface ResolvedConnection {
  id: string;
  alias: Alias;
  composioConnectionId: string | null;
  composioUserId: string | null;
  userHandle: string | null;
  lastSyncedAt: string | null;
}

export async function resolveActiveConnection(
  tenantSlug: string,
  toolkit: Toolkit
): Promise<ResolvedConnection | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("connected_accounts")
    .select(
      "id, alias, composio_connection_id, composio_user_id, user_handle, last_synced_at"
    )
    .eq("tenant_slug", tenantSlug)
    .eq("toolkit", toolkit)
    .eq("status", "active")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    alias: data.alias,
    composioConnectionId: data.composio_connection_id,
    composioUserId: data.composio_user_id,
    userHandle: data.user_handle,
    lastSyncedAt: data.last_synced_at,
  };
}

// List every active connection across all tenants for a given toolkit.
// Used by cron syncs that fan out across the whole platform.
export async function listActiveConnections(
  toolkit: Toolkit
): Promise<
  Array<ResolvedConnection & { tenantSlug: string }>
> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("connected_accounts")
    .select(
      "id, tenant_slug, alias, composio_connection_id, composio_user_id, user_handle, last_synced_at"
    )
    .eq("toolkit", toolkit)
    .eq("status", "active");

  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    tenantSlug: r.tenant_slug,
    alias: r.alias,
    composioConnectionId: r.composio_connection_id,
    composioUserId: r.composio_user_id,
    userHandle: r.user_handle,
    lastSyncedAt: r.last_synced_at,
  }));
}

// The Composio user_id we pass into tools.execute. Each alias gets its
// own Composio user, and Pulse stores that mapping on the row. Callers
// should always use the row's composio_user_id rather than reconstructing
// the alias-to-user mapping themselves.
export function userIdFor(conn: ResolvedConnection): string {
  return conn.composioUserId ?? conn.alias;
}
