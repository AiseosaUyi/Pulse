import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamMemberRecord, WeeklyTargets } from "@/lib/types/team";

export const DEFAULT_GRUVE_TEAM: Array<Omit<TeamMemberRecord, "id" | "tenantSlug" | "createdAt" | "updatedAt">> = [
  {
    name: "Aise",
    role: "Founder / Admin",
    active: true,
    weeklyTargets: { eventsCreated: 0, conversations: 0, reachOuts: 0, organicDms: 0 },
    userId: null,
  },
  {
    name: "Abas",
    role: "Head of Marketing",
    active: true,
    weeklyTargets: { eventsCreated: 25, conversations: 0, reachOuts: 0, organicDms: 0 },
    userId: null,
  },
  {
    name: "Abdul",
    role: "Partnerships and BD",
    active: true,
    weeklyTargets: { eventsCreated: 0, conversations: 40, reachOuts: 0, organicDms: 0 },
    userId: null,
  },
  {
    name: "Olamide",
    role: "Social Media",
    active: true,
    weeklyTargets: { eventsCreated: 0, conversations: 0, reachOuts: 0, organicDms: 20 },
    userId: null,
  },
  {
    name: "Ambassador 1",
    role: "Student Ambassador",
    active: true,
    weeklyTargets: { eventsCreated: 0, conversations: 0, reachOuts: 100, organicDms: 0 },
    userId: null,
  },
  {
    name: "Ambassador 2",
    role: "Student Ambassador",
    active: true,
    weeklyTargets: { eventsCreated: 0, conversations: 0, reachOuts: 100, organicDms: 0 },
    userId: null,
  },
];

export const DEFAULT_SIPPY_TEAM: Array<Omit<TeamMemberRecord, "id" | "tenantSlug" | "createdAt" | "updatedAt">> = [
  {
    name: "Aise",
    role: "Founder / Admin",
    active: true,
    weeklyTargets: { eventsCreated: 0, conversations: 0, reachOuts: 0, organicDms: 0 },
    userId: null,
  },
];

function fallbackTeamForTenant(tenantSlug: string): TeamMemberRecord[] {
  const now = new Date().toISOString();
  const list = tenantSlug === "gruve" ? DEFAULT_GRUVE_TEAM : DEFAULT_SIPPY_TEAM;
  return list.map((m, idx) => ({
    ...m,
    id: `fallback-${tenantSlug}-${idx}`,
    tenantSlug,
    createdAt: now,
    updatedAt: now,
  }));
}

export async function listTeamMembers(
  client: SupabaseClient,
  tenantSlug: string
): Promise<TeamMemberRecord[]> {
  try {
    const { data, error } = await client
      .from("tenant_team_members")
      .select("*")
      .eq("tenant_slug", tenantSlug)
      .order("created_at", { ascending: true });

    if (error || !data || data.length === 0) {
      return fallbackTeamForTenant(tenantSlug);
    }

    return data.map((row) => ({
      id: row.id as string,
      tenantSlug: row.tenant_slug as string,
      name: row.name as string,
      role: row.role as string,
      active: (row.active as boolean) ?? true,
      weeklyTargets: (row.weekly_targets as WeeklyTargets) ?? {},
      userId: (row.user_id as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  } catch {
    return fallbackTeamForTenant(tenantSlug);
  }
}

export async function upsertTeamMember(
  client: SupabaseClient,
  tenantSlug: string,
  input: {
    name: string;
    role: string;
    active?: boolean;
    weeklyTargets?: WeeklyTargets;
    userId?: string | null;
  }
): Promise<{ ok: true; member?: TeamMemberRecord } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    tenant_slug: tenantSlug,
    name: input.name.trim(),
    role: input.role.trim(),
    active: input.active ?? true,
    weekly_targets: input.weeklyTargets ?? {},
    updated_at: now,
  };
  if (input.userId !== undefined) {
    payload.user_id = input.userId;
  }

  const { data, error } = await client
    .from("tenant_team_members")
    .upsert(payload, { onConflict: "tenant_slug,name" })
    .select("*")
    .maybeSingle();

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
          role: data.role as string,
          active: data.active as boolean,
          weeklyTargets: (data.weekly_targets as WeeklyTargets) ?? {},
          userId: (data.user_id as string | null) ?? null,
          createdAt: data.created_at as string,
          updatedAt: data.updated_at as string,
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
    active?: boolean;
    weeklyTargets?: WeeklyTargets;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.role !== undefined) payload.role = patch.role.trim();
  if (patch.active !== undefined) payload.active = patch.active;
  if (patch.weeklyTargets !== undefined) payload.weekly_targets = patch.weeklyTargets;

  const { error } = await client
    .from("tenant_team_members")
    .update(payload)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteTeamMember(
  client: SupabaseClient,
  tenantSlug: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await client
    .from("tenant_team_members")
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

