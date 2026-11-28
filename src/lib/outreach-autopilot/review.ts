// Approve / edit / skip decisions on drafted outreach email. Shared by the
// token-authed digest page and the in-app Autopilot page; callers prove who
// they are first and pass the tenant (and, for a digest, the allowed ids).

import type { SupabaseClient } from "@supabase/supabase-js";

export type DraftChannel = "email" | "whatsapp" | "instagram";

export interface ReviewDraft {
  id: string;
  prospectId: string;
  kind: string;
  /** email: sent by the mailbox. whatsapp / instagram: sent by hand from a phone. */
  channel: DraftChannel;
  subject: string;
  body: string;
  toEmail: string | null;
  /** whatsapp: E.164 phone. instagram: handle. null for email. */
  toContact: string | null;
  status: string;
  sendVia: string | null;
  lintWarnings: string[];
  companyName: string | null;
  createdAt: string;
  /** Version stamp: an approval only applies to the exact text the reviewer saw. */
  updatedAt: string;
}

/**
 * Limits a review to the leads one teammate owns (team_people.id). Owners and
 * admins pass no scope and see everything in the tenant.
 */
export interface ReviewScope {
  ownerPersonId: string;
}

const asChannel = (v: unknown): DraftChannel => (v === "whatsapp" || v === "instagram" ? v : "email");

/** A draft is reviewable only when it has somewhere to go on its channel. */
const hasDestination = (r: { channel?: unknown; to_email?: unknown; to_contact?: unknown }) =>
  asChannel(r.channel) === "email" ? Boolean(r.to_email) : Boolean(r.to_contact);

async function ownedProspectIds(admin: SupabaseClient, tenantSlug: string, scope: ReviewScope): Promise<string[]> {
  const { data } = await admin
    .from("prospects")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("owner_person_id", scope.ownerPersonId)
    .limit(5000);
  return (data ?? []).map((r) => r.id as string);
}

const NO_ID = "00000000-0000-0000-0000-000000000000";

export async function listReviewDrafts(
  admin: SupabaseClient,
  tenantSlug: string,
  opts: { ids?: string[]; includeDecided?: boolean; limit?: number; scope?: ReviewScope; statuses?: string[] } = {}
): Promise<ReviewDraft[]> {
  let q = admin
    .from("outbound_dms")
    .select(
      "id, prospect_id, kind, channel, subject, body, to_email, to_contact, status, send_via, lint_warnings, created_at, updated_at, prospects(company_name, display_name)"
    )
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 100);
  if (opts.ids) q = q.in("id", opts.ids.length ? opts.ids : [NO_ID]);
  if (opts.scope) {
    const owned = await ownedProspectIds(admin, tenantSlug, opts.scope);
    q = q.in("prospect_id", owned.length ? owned : [NO_ID]);
  }
  if (opts.statuses) q = q.in("status", opts.statuses);
  else if (!opts.includeDecided) q = q.eq("status", "drafted");
  const { data } = await q;
  return (data ?? []).filter(hasDestination).map((r) => {
    const p = (Array.isArray(r.prospects) ? r.prospects[0] : r.prospects) as
      | { company_name?: string | null; display_name?: string | null }
      | null;
    return {
      id: r.id as string,
      prospectId: r.prospect_id as string,
      kind: r.kind as string,
      channel: asChannel(r.channel),
      subject: (r.subject as string) ?? "",
      body: (r.body as string) ?? "",
      toEmail: (r.to_email as string) ?? null,
      toContact: (r.to_contact as string) ?? null,
      status: r.status as string,
      sendVia: (r.send_via as string) ?? null,
      lintWarnings: Array.isArray(r.lint_warnings) ? (r.lint_warnings as string[]) : [],
      companyName: p?.company_name || p?.display_name || null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  });
}

export type ReviewAction = "approve" | "skip";

export interface DecideInput {
  dmId: string;
  action: ReviewAction;
  subject?: string;
  body?: string;
  /** updated_at of the version the reviewer was looking at. Required to approve. */
  expectedUpdatedAt?: string;
}

export type DecideResult = { ok: true; status: string; updatedAt?: string } | { ok: false; error: string };

const CHANGED = "This draft changed since you opened it. Reload to see the latest version.";
const NOT_YOURS = "This lead belongs to someone else";

interface DraftRow {
  id: string;
  prospectId: string;
  channel: DraftChannel;
  status: string;
  sendVia: string | null;
  hasDestination: boolean;
}

/** One draft in this tenant, or null. Also checks a member scope. */
async function loadDraft(
  admin: SupabaseClient,
  tenantSlug: string,
  dmId: string,
  scope?: ReviewScope
): Promise<DraftRow | "not_yours" | null> {
  const { data } = await admin
    .from("outbound_dms")
    .select("id, prospect_id, channel, status, send_via, to_email, to_contact")
    .eq("tenant_slug", tenantSlug)
    .eq("id", dmId)
    .maybeSingle();
  if (!data) return null;
  if (scope) {
    const { data: p } = await admin
      .from("prospects")
      .select("owner_person_id")
      .eq("tenant_slug", tenantSlug)
      .eq("id", data.prospect_id)
      .maybeSingle();
    if (!p || p.owner_person_id !== scope.ownerPersonId) return "not_yours";
  }
  return {
    id: data.id as string,
    prospectId: data.prospect_id as string,
    channel: asChannel(data.channel),
    status: data.status as string,
    sendVia: (data.send_via as string) ?? null,
    hasDestination: hasDestination(data),
  };
}

function cleanSubject(raw: string | undefined, channel: DraftChannel): { value?: string; error?: string } {
  if (raw === undefined) return {};
  const s = raw.replace(/[\r\n]+/g, " ").trim();
  if (!s) return channel === "email" ? { error: "Subject can't be empty" } : {};
  if (s.length > 200) return { error: "Subject is too long" };
  return { value: s };
}

/**
 * Approve (optionally with edits) or skip one draft. Only acts on a row that
 * is still 'drafted' in this tenant, so a second click or a stale tab can't
 * re-approve something already sent or skipped.
 *
 * Email approval queues it for the mailbox sender (send_via 'mailbox').
 * WhatsApp / Instagram approval never queues anything: it marks the draft
 * ready for a person to send from their phone (send_via 'by_hand'), which
 * the automatic sender ignores. Migration 119 enforces the same split.
 */
export async function decideDraft(
  admin: SupabaseClient,
  tenantSlug: string,
  input: DecideInput,
  meta: { via: "email_digest" | "in_app"; userId: string | null; allowedIds?: string[]; scope?: ReviewScope; now?: Date }
): Promise<DecideResult> {
  if (meta.allowedIds && !meta.allowedIds.includes(input.dmId)) {
    return { ok: false, error: "This draft is not part of this approval link" };
  }
  const row = await loadDraft(admin, tenantSlug, input.dmId, meta.scope);
  if (row === "not_yours") return { ok: false, error: NOT_YOURS };
  if (!row || !row.hasDestination) return { ok: false, error: "Already decided or not found" };

  const patch: Record<string, unknown> = {};
  const subject = cleanSubject(input.subject, row.channel);
  if (subject.error) return { ok: false, error: subject.error };
  if (subject.value !== undefined) patch.subject = subject.value;
  if (input.body !== undefined) {
    const b = input.body.replace(/\r\n/g, "\n").trim();
    if (!b) return { ok: false, error: "Message can't be empty" };
    if (b.length > 5000) return { ok: false, error: "Message is too long" };
    patch.body = b;
  }

  const nowIso = (meta.now ?? new Date()).toISOString();
  if (input.action === "approve" && !input.expectedUpdatedAt) {
    return { ok: false, error: CHANGED };
  }
  if (input.action === "approve") {
    const byHand = row.channel !== "email";
    Object.assign(patch, {
      status: "approved",
      send_via: byHand ? "by_hand" : "mailbox",
      approved_via: meta.via,
      approved_by: meta.userId,
      approved_at: nowIso,
      scheduled_send_at: byHand ? null : nowIso,
      error: null,
    });
  } else {
    Object.assign(patch, { status: "cancelled", error: "Skipped by reviewer" });
  }

  let q = admin
    .from("outbound_dms")
    .update(patch)
    .eq("tenant_slug", tenantSlug)
    .eq("id", input.dmId)
    .eq("status", "drafted");
  if (input.expectedUpdatedAt) q = q.eq("updated_at", input.expectedUpdatedAt);
  const { data, error } = await q.select("id, status, updated_at").maybeSingle();

  if (error) return { ok: false, error: "Could not save" };
  if (!data) return { ok: false, error: await whyNot(admin, tenantSlug, input.dmId) };
  return { ok: true, status: data.status as string, updatedAt: data.updated_at as string };
}

async function whyNot(admin: SupabaseClient, tenantSlug: string, dmId: string): Promise<string> {
  const { data } = await admin
    .from("outbound_dms")
    .select("status")
    .eq("tenant_slug", tenantSlug)
    .eq("id", dmId)
    .maybeSingle();
  return data?.status === "drafted" ? CHANGED : "Already decided or not found";
}

/**
 * Records that a person sent an approved WhatsApp / Instagram draft from their
 * own phone. Pulse sent nothing: this only moves the row to 'sent' so it
 * leaves the queue and the lead's history shows it. Email rows are refused.
 */
export async function markSentByHand(
  admin: SupabaseClient,
  tenantSlug: string,
  dmId: string,
  meta: { userId: string | null; allowedIds?: string[]; scope?: ReviewScope; now?: Date }
): Promise<DecideResult> {
  if (meta.allowedIds && !meta.allowedIds.includes(dmId)) {
    return { ok: false, error: "This draft is not part of this approval link" };
  }
  const row = await loadDraft(admin, tenantSlug, dmId, meta.scope);
  if (row === "not_yours") return { ok: false, error: NOT_YOURS };
  if (!row) return { ok: false, error: "Not found" };
  if (row.channel === "email") return { ok: false, error: "Emails are sent by the mailbox, not by hand" };
  if (row.status === "sent") return { ok: true, status: "sent" };
  if (row.status !== "approved" || row.sendVia !== "by_hand") return { ok: false, error: "Approve it first" };

  const sentAt = (meta.now ?? new Date()).toISOString();
  const { data } = await admin
    .from("outbound_dms")
    .update({ status: "sent", sent_at: sentAt, error: null })
    .eq("tenant_slug", tenantSlug)
    .eq("id", dmId)
    .eq("status", "approved")
    .eq("send_via", "by_hand")
    .select("id, status, updated_at")
    .maybeSingle();
  if (!data) return { ok: false, error: "Already marked or changed" };

  await admin
    .from("prospects")
    .update({ last_touched_at: sentAt })
    .eq("tenant_slug", tenantSlug)
    .eq("id", row.prospectId);
  return { ok: true, status: "sent", updatedAt: data.updated_at as string };
}

/** Edit without deciding (save a draft change). Chat drafts need no subject. */
export async function editDraft(
  admin: SupabaseClient,
  tenantSlug: string,
  input: { dmId: string; subject: string; body: string; expectedUpdatedAt: string },
  allowedIds?: string[],
  scope?: ReviewScope
): Promise<DecideResult> {
  if (allowedIds && !allowedIds.includes(input.dmId)) {
    return { ok: false, error: "This draft is not part of this approval link" };
  }
  const row = await loadDraft(admin, tenantSlug, input.dmId, scope);
  if (row === "not_yours") return { ok: false, error: NOT_YOURS };
  if (!row) return { ok: false, error: "Already decided or not found" };
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!body || (row.channel === "email" && !subject)) {
    return { ok: false, error: row.channel === "email" ? "Subject and message are required" : "Message is required" };
  }
  if (subject.length > 200 || body.length > 5000) return { ok: false, error: "Too long" };
  const { data } = await admin
    .from("outbound_dms")
    .update(row.channel === "email" || subject ? { subject, body } : { body })
    .eq("tenant_slug", tenantSlug)
    .eq("id", input.dmId)
    .eq("status", "drafted")
    .eq("updated_at", input.expectedUpdatedAt)
    .select("id, status, updated_at")
    .maybeSingle();
  return data
    ? { ok: true, status: data.status as string, updatedAt: data.updated_at as string }
    : { ok: false, error: await whyNot(admin, tenantSlug, input.dmId) };
}

/** Pull an approved draft back before it goes out (email) or is sent by hand (chat). */
export async function unapproveDraft(
  admin: SupabaseClient,
  tenantSlug: string,
  dmId: string,
  scope?: ReviewScope
): Promise<DecideResult> {
  if (scope) {
    const row = await loadDraft(admin, tenantSlug, dmId, scope);
    if (row === "not_yours") return { ok: false, error: NOT_YOURS };
    if (!row) return { ok: false, error: "Not found" };
  }
  const { data } = await admin
    .from("outbound_dms")
    .update({ status: "drafted", send_via: null, approved_at: null, approved_via: null, scheduled_send_at: null })
    .eq("tenant_slug", tenantSlug)
    .eq("id", dmId)
    .eq("status", "approved")
    .select("id, status")
    .maybeSingle();
  if (!data) return { ok: false, error: "Already sending or sent" };

  // An old approval link must not be able to re-approve a pulled-back email.
  const { data: digests } = await admin
    .from("outreach_digests")
    .select("id, dm_ids")
    .eq("tenant_slug", tenantSlug)
    .contains("dm_ids", [dmId]);
  for (const d of digests ?? []) {
    await admin
      .from("outreach_digests")
      .update({ dm_ids: ((d.dm_ids as string[]) ?? []).filter((x) => x !== dmId) })
      .eq("id", d.id);
  }
  return { ok: true, status: "drafted" };
}
