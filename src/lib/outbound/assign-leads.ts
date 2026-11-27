// Share unowned leads among the workspace's team, so a list never sits
// untouched because nobody was told it is theirs. Runs daily (cron
// assign-leads) and once when an owner turns it on.
//
//   who:   active roster people with a login in this workspace (not support)
//   what:  leads with no owner that are still worth working, best first
//          (replied > qualified > qualifying > new; hot > warm > unscored > cold;
//          newest first); duplicates and dead leads are skipped
//   how:   each lead goes to whoever has the fewest open leads right now, up to
//          a daily number per person, so nobody is buried
//
// Only the owner fields change. Nothing is sent and no status changes.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface LeadAssignmentConfig {
  enabled: boolean;
  /** New leads each person gets per day. */
  perPersonPerDay: number;
}

export const DEFAULT_LEAD_ASSIGNMENT: LeadAssignmentConfig = { enabled: false, perPersonPerDay: 15 };

export function readLeadAssignment(settings: unknown): LeadAssignmentConfig {
  const raw = (settings as { leadAssignment?: Partial<LeadAssignmentConfig> } | null)?.leadAssignment ?? {};
  const n = Number(raw.perPersonPerDay);
  return {
    enabled: raw.enabled === true,
    perPersonPerDay: Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 100) : DEFAULT_LEAD_ASSIGNMENT.perPersonPerDay,
  };
}

/** Statuses a lead can be handed out in, best first. */
const ASSIGNABLE = ["replied", "qualified", "qualifying", "new"] as const;
/** Statuses that count toward someone's current load. */
const OPEN = ["new", "qualifying", "qualified", "drafted", "approved", "sent", "replied"];
const QUALITY_RANK: Record<string, number> = { hot: 0, warm: 1, unscored: 2, cold: 3 };

interface Person {
  id: string;
  name: string;
}

export interface AssignResult {
  assigned: number;
  people: number;
}

async function teamFor(admin: SupabaseClient, tenantSlug: string): Promise<Person[]> {
  const [{ data: members }, { data: roster }] = await Promise.all([
    admin.from("memberships").select("user_id, role").eq("tenant_slug", tenantSlug),
    admin.from("team_people").select("id, name, user_id, active").eq("tenant_slug", tenantSlug).eq("active", true),
  ]);
  const workers = new Set(
    (members ?? []).filter((m) => m.role !== "support").map((m) => m.user_id as string)
  );
  return (roster ?? [])
    .filter((p) => p.user_id && workers.has(p.user_id as string))
    .map((p) => ({ id: p.id as string, name: p.name as string }));
}

export async function assignNewLeads(
  admin: SupabaseClient,
  tenantSlug: string,
  cfg: Pick<LeadAssignmentConfig, "perPersonPerDay">
): Promise<AssignResult> {
  const team = await teamFor(admin, tenantSlug);
  if (!team.length) return { assigned: 0, people: 0 };

  // Current load: open leads each person already owns.
  const { data: owned } = await admin
    .from("prospects")
    .select("owner_person_id")
    .eq("tenant_slug", tenantSlug)
    .in("owner_person_id", team.map((p) => p.id))
    .in("status", OPEN)
    .limit(20000);
  const load = new Map<string, number>(team.map((p) => [p.id, 0]));
  for (const r of owned ?? []) {
    const id = r.owner_person_id as string;
    load.set(id, (load.get(id) ?? 0) + 1);
  }

  const room = team.length * cfg.perPersonPerDay;
  const { data: rows } = await admin
    .from("prospects")
    .select("id, status, quality, created_at, duplicate_of_id")
    .eq("tenant_slug", tenantSlug)
    .is("owner_person_id", null)
    .in("status", [...ASSIGNABLE])
    .order("created_at", { ascending: false })
    .limit(Math.max(room * 4, 200));

  const rank = (s: string) => ASSIGNABLE.indexOf(s as (typeof ASSIGNABLE)[number]);
  const candidates = (rows ?? [])
    .filter((r) => !r.duplicate_of_id && r.quality !== "dead")
    .sort(
      (a, b) =>
        rank(a.status as string) - rank(b.status as string) ||
        (QUALITY_RANK[(a.quality as string) ?? "unscored"] ?? 2) - (QUALITY_RANK[(b.quality as string) ?? "unscored"] ?? 2) ||
        String(b.created_at).localeCompare(String(a.created_at))
    )
    .slice(0, room);

  const given = new Map<string, number>(team.map((p) => [p.id, 0]));
  let assigned = 0;
  for (const lead of candidates) {
    const open = team.filter((p) => (given.get(p.id) ?? 0) < cfg.perPersonPerDay);
    if (!open.length) break;
    // Fewest open leads first; ties go to whoever got fewer this run, then by name.
    open.sort(
      (a, b) =>
        (load.get(a.id) ?? 0) + (given.get(a.id) ?? 0) - ((load.get(b.id) ?? 0) + (given.get(b.id) ?? 0)) ||
        a.name.localeCompare(b.name)
    );
    const person = open[0];
    // Only claim a lead nobody took in the meantime.
    const { data: hit } = await admin
      .from("prospects")
      .update({ owner_person_id: person.id, owner: person.name })
      .eq("tenant_slug", tenantSlug)
      .eq("id", lead.id)
      .is("owner_person_id", null)
      .select("id")
      .maybeSingle();
    if (hit) {
      given.set(person.id, (given.get(person.id) ?? 0) + 1);
      assigned++;
    }
  }
  return { assigned, people: team.length };
}
