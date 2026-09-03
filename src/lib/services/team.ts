// Tenant member lookups shared across features that need to resolve a
// membership user_id to a display name/avatar (e.g. the Action Queue's
// assignee picker and "claimed by X" state). Extracted from the one-off
// query settings/team/page.tsx already runs inline — that page is left
// as-is, this is for new client-injected call sites.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface TenantMemberSummary {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  role: string;
}

export async function listTenantMembers(
  client: SupabaseClient,
  tenantSlug: string
): Promise<TenantMemberSummary[]> {
  const { data: memberships } = await client
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: true });

  const userIds = (memberships ?? []).map((m) => m.user_id as string);
  if (userIds.length === 0) return [];

  const { data: profiles } = await client
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", userIds);

  const profileMap = new Map<
    string,
    { display_name: string | null; username: string | null; avatar_url: string | null }
  >();
  for (const p of profiles ?? []) {
    profileMap.set(p.id as string, {
      display_name: p.display_name as string | null,
      username: p.username as string | null,
      avatar_url: p.avatar_url as string | null,
    });
  }

  return (memberships ?? []).map((m) => {
    const profile = profileMap.get(m.user_id as string);
    return {
      userId: m.user_id as string,
      role: m.role as string,
      displayName: profile?.display_name ?? "—",
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    };
  });
}
