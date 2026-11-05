import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamMemberRecord, WeeklyTargets } from "@/lib/types/team";
import { unassignDepartedPerson } from "@/lib/services/tasks";

export { unassignDepartedPerson };

export async function listTeamMembers(
  client: SupabaseClient,
  tenantSlug: string,
  options?: { activeOnly?: boolean }
): Promise<TeamMemberRecord[]> {
  let query = client
    .from("team_people")
    .select("id, tenant_slug, name, role_title, tags, weekly_targets, email, user_id, active, created_at, updated_at")
    .eq("tenant_slug", tenantSlug)
    .order("name", { ascending: true });

  if (options?.activeOnly !== false) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load team roster for tenant '${tenantSlug}': ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    name: row.name as string,
    role: (row.role_title as string) || "Member",
    roleTitle: (row.role_title as string) || null,
    tags: (row.tags as string[]) || [],
    email: (row.email as string) || null,
    active: (row.active as boolean) ?? true,
    weeklyTargets: (row.weekly_targets as WeeklyTargets) ?? {},
    userId: (row.user_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) || (row.created_at as string),
  }));
}

export async function upsertTeamMember(
  client: SupabaseClient,
  tenantSlug: string,
  input: {
    id?: string;
    name: string;
    role?: string;
    roleTitle?: string;
    tags?: string[];
    email?: string | null;
    active?: boolean;
    weeklyTargets?: WeeklyTargets;
    userId?: string | null;
  }
): Promise<{ ok: true; member?: TeamMemberRecord } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const roleTitle = input.roleTitle?.trim() || input.role?.trim() || "Member";
  const tags = input.tags ?? (roleTitle.toLowerCase().includes("ambassador") ? ["ambassador"] : []);

  const payload: Record<string, unknown> = {
    tenant_slug: tenantSlug,
    name: input.name.trim(),
    role_title: roleTitle,
    tags,
    active: input.active ?? true,
    weekly_targets: input.weeklyTargets ?? {},
    updated_at: now,
  };
  if (input.email !== undefined) {
    payload.email = input.email ? input.email.trim() : null;
  }
  if (input.userId !== undefined) {
    payload.user_id = input.userId;
  }

  let data: Record<string, unknown> | null = null;
  let error: { message: string } | null = null;

  if (input.id) {
    const res = await client
      .from("team_people")
      .update(payload)
      .eq("tenant_slug", tenantSlug)
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    data = res.data;
    error = res.error;
  } else if (input.userId) {
    const res = await client
      .from("team_people")
      .upsert(payload, { onConflict: "tenant_slug,user_id" })
      .select("*")
      .maybeSingle();
    data = res.data;
    error = res.error;
  } else {
    // External person with no login
    const res = await client
      .from("team_people")
      .insert(payload)
      .select("*")
      .maybeSingle();
    data = res.data;
    error = res.error;
  }

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    member: data
      ? {
          id: data.id as string,
          tenantSlug: data.tenant_slug as string,
          name: data.name as string,
          role: (data.role_title as string) || "Member",
          roleTitle: (data.role_title as string) || null,
          tags: (data.tags as string[]) || [],
          email: (data.email as string) || null,
          active: data.active as boolean,
          weeklyTargets: (data.weekly_targets as WeeklyTargets) ?? {},
          userId: (data.user_id as string | null) ?? null,
          createdAt: data.created_at as string,
          updatedAt: (data.updated_at as string) || (data.created_at as string),
        }
      : undefined,
  };
}

export async function updateTeamMember(
  client: SupabaseClient,
  tenantSlug: string,
  id: string,
  patch: {
    name?: string;
    role?: string;
    roleTitle?: string;
    tags?: string[];
    email?: string | null;
    active?: boolean;
    weeklyTargets?: WeeklyTargets;
    userId?: string | null;
  },
  actorId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  // If deactivating, trigger unassignment of open work
  if (patch.active === false) {
    await unassignDepartedPerson(client, tenantSlug, id, actorId);
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.roleTitle !== undefined) payload.role_title = patch.roleTitle.trim();
  else if (patch.role !== undefined) payload.role_title = patch.role.trim();
  if (patch.tags !== undefined) payload.tags = patch.tags;
  if (patch.email !== undefined) payload.email = patch.email ? patch.email.trim() : null;
  if (patch.active !== undefined) payload.active = patch.active;
  if (patch.weeklyTargets !== undefined) payload.weekly_targets = patch.weeklyTargets;
  if (patch.userId !== undefined) payload.user_id = patch.userId;

  const { error } = await client
    .from("team_people")
    .update(payload)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteTeamMember(
  client: SupabaseClient,
  tenantSlug: string,
  id: string,
  actorId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Unassign before deletion/deactivation
  await unassignDepartedPerson(client, tenantSlug, id, actorId);

  const { error } = await client
    .from("team_people")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Legacy Tenant Member Lookups ─────────────────────────────────────────────

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
