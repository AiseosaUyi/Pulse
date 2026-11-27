// Who approves a draft: the teammate who owns the lead, or the workspace
// approver (outreach_mailboxes.approver_email) when the lead has no usable
// owner. Used to split the daily digest and the reply alert into one email
// per approver, each with a link scoped to only that person's drafts.
//
// A lead owner counts only when ALL of these hold:
//   - prospects.owner_person_id points to an ACTIVE team_people row in this tenant
//   - that row has a user_id (a login) with a membership in this tenant
//   - the membership role is not 'support'
//   - there is an email: team_people.email, else the login's auth email
// Anything else falls back to the workspace approver.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Approver {
  /** Lowercased, trimmed. */
  email: string;
  /** auth user id of the lead owner; null for the workspace approver. */
  userId: string | null;
  /** true when this is the lead's owner, false for the workspace approver. */
  isOwner: boolean;
}

export type AuthEmailLookup = (userId: string) => Promise<string | null>;

const looksLikeEmail = (s: string | null | undefined): s is string =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

const norm = (s: string) => s.trim().toLowerCase();

/** Reads a login's email through the service-role auth API. */
export function authEmailLookup(admin: SupabaseClient): AuthEmailLookup {
  return async (userId) => {
    try {
      const { data } = await admin.auth.admin.getUserById(userId);
      return data?.user?.email ?? null;
    } catch {
      return null;
    }
  };
}

/**
 * Map of prospectId -> approver for every id passed in. Ids with no usable
 * owner (or unknown ids) map to the workspace approver.
 */
export async function resolveApprovers(
  admin: SupabaseClient,
  tenantSlug: string,
  prospectIds: string[],
  fallbackEmail: string,
  lookupAuthEmail: AuthEmailLookup = authEmailLookup(admin)
): Promise<Map<string, Approver>> {
  const fallback: Approver = { email: norm(fallbackEmail), userId: null, isOwner: false };
  const out = new Map<string, Approver>();
  const ids = [...new Set(prospectIds.filter(Boolean))];
  for (const id of ids) out.set(id, fallback);
  if (!ids.length) return out;

  const { data: prospects } = await admin
    .from("prospects")
    .select("id, owner_person_id")
    .eq("tenant_slug", tenantSlug)
    .in("id", ids);
  const personIds = [
    ...new Set((prospects ?? []).map((p) => p.owner_person_id as string | null).filter((x): x is string => Boolean(x))),
  ];
  if (!personIds.length) return out;

  const { data: people } = await admin
    .from("team_people")
    .select("id, user_id, email, active")
    .eq("tenant_slug", tenantSlug)
    .eq("active", true)
    .in("id", personIds);
  const withLogin = (people ?? []).filter((p) => p.active === true && Boolean(p.user_id));
  const userIds = [...new Set(withLogin.map((p) => p.user_id as string))];
  if (!userIds.length) return out;

  const { data: members } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("tenant_slug", tenantSlug)
    .in("user_id", userIds);
  const allowed = new Set(
    (members ?? []).filter((m) => m.role && m.role !== "support").map((m) => m.user_id as string)
  );

  const byPerson = new Map<string, Approver>();
  for (const p of withLogin) {
    const userId = p.user_id as string;
    if (!allowed.has(userId)) continue;
    let email = looksLikeEmail(p.email as string | null) ? (p.email as string) : null;
    if (!email) {
      const authEmail = await lookupAuthEmail(userId);
      email = looksLikeEmail(authEmail) ? authEmail : null;
    }
    if (!email) continue;
    byPerson.set(p.id as string, { email: norm(email), userId, isOwner: true });
  }

  for (const p of prospects ?? []) {
    const a = byPerson.get(p.owner_person_id as string);
    if (a) out.set(p.id as string, a);
  }
  return out;
}

export interface ApproverGroup<T> {
  approver: Approver;
  items: T[];
}

/**
 * Groups items by approver email, keeping first-seen order. If a lead owner
 * is also the workspace approver, their items land in one group (and the
 * group keeps the owner's user id for the audit).
 */
export function groupByApprover<T>(
  items: T[],
  prospectIdOf: (item: T) => string,
  approvers: Map<string, Approver>,
  fallbackEmail: string
): ApproverGroup<T>[] {
  const fallback: Approver = { email: norm(fallbackEmail), userId: null, isOwner: false };
  const groups = new Map<string, ApproverGroup<T>>();
  for (const item of items) {
    const a = approvers.get(prospectIdOf(item)) ?? fallback;
    const g = groups.get(a.email);
    if (g) {
      g.items.push(item);
      if (!g.approver.userId && a.userId) g.approver = a;
    } else {
      groups.set(a.email, { approver: a, items: [item] });
    }
  }
  return [...groups.values()];
}
