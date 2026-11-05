"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { getTenantPeople } from "@/lib/services/tasks";
import type { TeamPerson } from "@/lib/types/tasks";

export async function listPeopleAction(
  tenantSlug?: string
): Promise<{
  people: TeamPerson[];
  currentUserId: string | null;
  isAdmin: boolean;
  tenantSlug: string;
} | null> {
  const user = await getCurrentUser();
  const currentTenant = await getCurrentTenant();
  const slug = tenantSlug || currentTenant?.slug;
  if (!slug) return null;

  const supabase = await createClient();
  const people = await getTenantPeople(supabase, slug, { activeOnly: false });

  const isAdmin = currentTenant?.role === "owner" || currentTenant?.role === "admin";

  return {
    people,
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
