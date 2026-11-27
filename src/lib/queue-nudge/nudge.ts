// Daily "your queue" nudge, per tenant: archive stale items, then email each
// teammate who has open work a short note. Internal email to teammates only.
//
// Who gets one: an active team_people row with a login in this tenant
// (user_id has a membership here) and an email address. Owners and admins
// also see unassigned items. The support role is skipped: its access is
// limited to Conversations and the email links to the dashboard.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getMyDay } from "@/lib/services/my-day";
import {
  buildQueueNudgeEmail,
  queueNudgeSubject,
  queueNudgeTotal,
  type NudgeItemKind,
  type NudgeOldestItem,
} from "./email";
import { archiveStaleItems, selectStaleItems } from "./stale";

export interface NudgeRecipient {
  personId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  seesUnassigned: boolean;
}

export interface PersonQueue {
  replies: number;
  followUps: number;
  decisions: number;
  oldest: NudgeOldestItem[];
}

export interface QueueLine {
  key: string;
  kind: NudgeItemKind;
  label: string;
  since: string;
}

export interface TenantNudgeResult {
  tenant: string;
  archived: number;
  emailed: number;
  skippedNothingOpen: number;
  errors: string[];
}

export interface NudgeDeps {
  /** Overridable for tests. Defaults to gatherPersonQueue (getMyDay based). */
  gather?: (client: SupabaseClient, tenantSlug: string, r: NudgeRecipient, now: Date) => Promise<PersonQueue>;
  /** Falls back to the auth user's email when team_people.email is empty. */
  resolveEmail?: (userId: string) => Promise<string | null>;
  send: (msg: { to: string; name: string; subject: string; html: string }) => Promise<{ ok: boolean; error?: string }>;
  now?: Date;
  appUrl: string;
}

export async function listNudgeRecipients(
  client: SupabaseClient,
  tenantSlug: string,
  resolveEmail?: (userId: string) => Promise<string | null>
): Promise<NudgeRecipient[]> {
  const [peopleRes, membersRes] = await Promise.all([
    client
      .from("team_people")
      .select("id, name, email, user_id, active")
      .eq("tenant_slug", tenantSlug)
      .eq("active", true),
    client.from("memberships").select("user_id, role").eq("tenant_slug", tenantSlug),
  ]);
  if (peopleRes.error) throw new Error(`team_people: ${peopleRes.error.message}`);
  if (membersRes.error) throw new Error(`memberships: ${membersRes.error.message}`);

  const roleByUser = new Map<string, string>();
  for (const m of (membersRes.data ?? []) as Array<{ user_id: string; role: string }>) {
    roleByUser.set(m.user_id, m.role);
  }

  const out: NudgeRecipient[] = [];
  const seenUsers = new Set<string>();
  for (const p of (peopleRes.data ?? []) as Array<Record<string, unknown>>) {
    const userId = p.user_id as string | null;
    if (!userId || seenUsers.has(userId)) continue;
    const role = roleByUser.get(userId);
    if (!role || role === "support") continue;

    let email = ((p.email as string | null) ?? "").trim();
    if (!email && resolveEmail) email = ((await resolveEmail(userId)) ?? "").trim();
    if (!email) continue;

    seenUsers.add(userId);
    out.push({
      personId: p.id as string,
      userId,
      name: ((p.name as string | null) ?? "").trim() || "there",
      email,
      role,
      seesUnassigned: role === "owner" || role === "admin",
    });
  }
  return out;
}

function ageDays(since: string, now: Date): number {
  const t = new Date(since).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

/** Pure: dedupe, count by kind, pick the 5 oldest. */
export function summarizeQueue(lines: QueueLine[], now: Date): PersonQueue {
  const unique = new Map<string, QueueLine>();
  for (const l of lines) if (!unique.has(l.key)) unique.set(l.key, l);
  const all = [...unique.values()];
  const oldest = [...all]
    .sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime())
    .slice(0, 5)
    .map((l) => ({ kind: l.kind, label: l.label, ageDays: ageDays(l.since, now) }));
  return {
    replies: all.filter((l) => l.kind === "reply").length,
    followUps: all.filter((l) => l.kind === "follow_up").length,
    decisions: all.filter((l) => l.kind === "decision").length,
    oldest,
  };
}

async function linesFor(client: SupabaseClient, tenantSlug: string, owner: string, now: Date): Promise<QueueLine[]> {
  // My Day is the per-person view of replies and follow-ups (owner_person_id
  // on action/engagement items, the lead's owner for inbound messages).
  const day = await getMyDay(client, tenantSlug, { owner, nowMs: now.getTime() });
  const lines: QueueLine[] = [];
  for (const r of day.replyNow) {
    const who = r.displayName || (r.handle && r.handle !== "unknown" ? `@${r.handle}` : "");
    lines.push({
      key: `${r.source}:${r.id}`,
      kind: "reply",
      label: who ? `${who}: ${r.body}` : r.body || "Reply waiting",
      since: r.receivedAt,
    });
  }
  for (const f of day.followUpToday) {
    lines.push({
      key: `${f.source}:${f.id}`,
      kind: "follow_up",
      label: f.name || f.handle,
      since: f.dueAt ?? now.toISOString(),
    });
  }

  // Decisions are not part of My Day, so read them the same way it reads
  // action items: open, owned by this person (or unassigned).
  let q = client
    .from("action_items")
    .select("id, title, created_at, snoozed_until")
    .eq("tenant_slug", tenantSlug)
    .eq("status", "open")
    .in("kind", ["decision", "escalation"]);
  q = owner === "unassigned" ? q.is("owner_person_id", null) : q.eq("owner_person_id", owner);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(100);
  if (error) throw new Error(`action_items decisions: ${error.message}`);
  for (const a of (data ?? []) as Array<Record<string, unknown>>) {
    const snooze = a.snoozed_until as string | null;
    if (snooze && new Date(snooze).getTime() > now.getTime()) continue;
    lines.push({
      key: `action:${a.id as string}`,
      kind: "decision",
      label: (a.title as string) ?? "Decision",
      since: a.created_at as string,
    });
  }
  return lines;
}

export async function gatherPersonQueue(
  client: SupabaseClient,
  tenantSlug: string,
  r: NudgeRecipient,
  now: Date
): Promise<PersonQueue> {
  const lines = await linesFor(client, tenantSlug, r.personId, now);
  if (r.seesUnassigned) lines.push(...(await linesFor(client, tenantSlug, "unassigned", now)));
  return summarizeQueue(lines, now);
}

export async function runQueueNudgeForTenant(
  client: SupabaseClient,
  tenant: { slug: string; name: string | null },
  deps: NudgeDeps
): Promise<TenantNudgeResult> {
  const now = deps.now ?? new Date();
  const gather = deps.gather ?? gatherPersonQueue;
  const result: TenantNudgeResult = {
    tenant: tenant.slug,
    archived: 0,
    emailed: 0,
    skippedNothingOpen: 0,
    errors: [],
  };

  // 1. Cleanup first, so the counts in the email are what is left.
  try {
    const stale = await selectStaleItems(client, tenant.slug, now);
    if (stale.length > 0) {
      const archived = await archiveStaleItems(client, tenant.slug, stale, now);
      result.archived = archived.archived;
      if (archived.error) result.errors.push(`archive: ${archived.error}`);
    }
  } catch (err) {
    result.errors.push(`archive: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. One email per teammate with open work.
  const recipients = await listNudgeRecipients(client, tenant.slug, deps.resolveEmail);
  const dashboardUrl = `${deps.appUrl.replace(/\/$/, "")}/dashboard`;
  for (const r of recipients) {
    try {
      const queue = await gather(client, tenant.slug, r, now);
      if (queueNudgeTotal(queue) === 0) {
        result.skippedNothingOpen += 1;
        continue;
      }
      const input = {
        name: r.name,
        tenantName: tenant.name || tenant.slug,
        replies: queue.replies,
        followUps: queue.followUps,
        decisions: queue.decisions,
        oldest: queue.oldest,
        archivedCount: r.seesUnassigned ? result.archived : 0,
        dashboardUrl,
      };
      const sent = await deps.send({
        to: r.email,
        name: r.name,
        subject: queueNudgeSubject(input),
        html: buildQueueNudgeEmail(input),
      });
      if (sent.ok) result.emailed += 1;
      else result.errors.push(`${r.personId}: ${sent.error ?? "send failed"}`);
    } catch (err) {
      result.errors.push(`${r.personId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
