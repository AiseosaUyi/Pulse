"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { getTenantPeople } from "@/lib/services/tasks";
import type { TeamPerson } from "@/lib/types/tasks";

export async function listPeopleAction(
  tenantSlug?: string
): Promise<{
  /** Everyone on the roster, for showing names on existing assignments. */
  people: TeamPerson[];
  /** Roster ids with a login in this workspace: the only ones offered in pickers and filters. */
  teamIds: string[];
  currentUserId: string | null;
  isAdmin: boolean;
  tenantSlug: string;
} | null> {
  const user = await getCurrentUser();
  const currentTenant = await getCurrentTenant();
  const slug = tenantSlug || currentTenant?.slug;
  if (!slug) return null;

  const supabase = await createClient();
  const [people, { data: members }] = await Promise.all([
    getTenantPeople(supabase, slug, { activeOnly: false }),
    supabase.from("memberships").select("user_id").eq("tenant_slug", slug),
  ]);
  // Pickers and filters offer only people on the workspace's team (a login in
  // this workspace). Roster-only names such as placeholders are left out of
  // them; leads already assigned to them still show that name.
  const memberIds = new Set((members ?? []).map((m) => m.user_id as string));
  const teamIds = people.filter((p) => p.userId && memberIds.has(p.userId)).map((p) => p.id);

  const isAdmin = currentTenant?.role === "owner" || currentTenant?.role === "admin";

  return {
    people,
    teamIds,
    currentUserId: user?.id ?? null,
    isAdmin,
    tenantSlug: slug,
  };
}

export async function setProspectOwnerAction(
  prospectId: string,
  ownerPersonId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { ok: false, error: "No active tenant" };

  const admin = createAdminClient();

  let personName: string | null = null;
  if (ownerPersonId) {
    const { data: person, error: pErr } = await admin
      .from("team_people")
      .select("id, name")
      .eq("tenant_slug", currentTenant.slug)
      .eq("id", ownerPersonId)
      .maybeSingle();

    if (pErr || !person) {
      return { ok: false, error: "Person does not exist" };
    }
    personName = person.name;
  }

  // Update without bumping status_updated_at
  const { error } = await admin
    .from("prospects")
    .update({
      owner_person_id: ownerPersonId,
      owner: personName,
    })
    .eq("tenant_slug", currentTenant.slug)
    .eq("id", prospectId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setProspectPriorityAction(
  prospectId: string,
  priority: string
): Promise<{ ok: boolean; error?: string }> {
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) return { ok: false, error: "No active tenant" };

  const admin = createAdminClient();
  const cleanPriority = priority.trim().toUpperCase();

  // Update without touching signal_data or bumping status_updated_at
  const { error } = await admin
    .from("prospects")
    .update({
      priority: cleanPriority,
    })
    .eq("tenant_slug", currentTenant.slug)
    .eq("id", prospectId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
