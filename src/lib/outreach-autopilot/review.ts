// Approve / edit / skip decisions on drafted outreach email. Shared by the
// token-authed digest page and the in-app Autopilot page; callers prove who
// they are first and pass the tenant (and, for a digest, the allowed ids).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReviewDraft {
  id: string;
  prospectId: string;
  kind: string;
  subject: string;
  body: string;
  toEmail: string | null;
  status: string;
  lintWarnings: string[];
  companyName: string | null;
  createdAt: string;
  /** Version stamp: an approval only applies to the exact text the reviewer saw. */
  updatedAt: string;
}

export async function listReviewDrafts(
  admin: SupabaseClient,
  tenantSlug: string,
  opts: { ids?: string[]; includeDecided?: boolean; limit?: number } = {}
): Promise<ReviewDraft[]> {
  let q = admin
    .from("outbound_dms")
    .select("id, prospect_id, kind, subject, body, to_email, status, lint_warnings, created_at, updated_at, prospects(company_name, display_name)")
    .eq("tenant_slug", tenantSlug)
    .not("to_email", "is", null)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 100);
  if (opts.ids) q = q.in("id", opts.ids.length ? opts.ids : ["00000000-0000-0000-0000-000000000000"]);
  if (!opts.includeDecided) q = q.eq("status", "drafted");
  const { data } = await q;
  return (data ?? []).map((r) => {
    const p = (Array.isArray(r.prospects) ? r.prospects[0] : r.prospects) as
      | { company_name?: string | null; display_name?: string | null }
      | null;
    return {
      id: r.id as string,
      prospectId: r.prospect_id as string,
      kind: r.kind as string,
      subject: (r.subject as string) ?? "",
      body: (r.body as string) ?? "",
      toEmail: (r.to_email as string) ?? null,
      status: r.status as string,
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

/**
 * Approve (optionally with edits) or skip one drafted email. Only acts on a
 * row that is still 'drafted' in this tenant, so a second click or a stale
 * tab can't re-approve something already sent or skipped.
 */
export async function decideDraft(
  admin: SupabaseClient,
  tenantSlug: string,
  input: DecideInput,
  meta: { via: "email_digest" | "in_app"; userId: string | null; allowedIds?: string[]; now?: Date }
): Promise<DecideResult> {
  if (meta.allowedIds && !meta.allowedIds.includes(input.dmId)) {
    return { ok: false, error: "This draft is not part of this approval link" };
  }

  const patch: Record<string, unknown> = {};
  if (input.subject !== undefined) {
    const s = input.subject.replace(/[\r\n]+/g, " ").trim();
    if (!s) return { ok: false, error: "Subject can't be empty" };
    if (s.length > 200) return { ok: false, error: "Subject is too long" };
    patch.subject = s;
  }
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
    Object.assign(patch, {
      status: "approved",
      send_via: "mailbox",
      approved_via: meta.via,
      approved_by: meta.userId,
      approved_at: nowIso,
      scheduled_send_at: nowIso,
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
    .eq("status", "drafted")
    .not("to_email", "is", null);
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

/** Edit without deciding (save a draft change). */
export async function editDraft(
  admin: SupabaseClient,
  tenantSlug: string,
  input: { dmId: string; subject: string; body: string; expectedUpdatedAt: string },
  allowedIds?: string[]
): Promise<DecideResult> {
  if (allowedIds && !allowedIds.includes(input.dmId)) {
    return { ok: false, error: "This draft is not part of this approval link" };
  }
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!subject || !body) return { ok: false, error: "Subject and message are required" };
  if (subject.length > 200 || body.length > 5000) return { ok: false, error: "Too long" };
  const { data } = await admin
    .from("outbound_dms")
    .update({ subject, body })
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

/** Pull an approved email back before it goes out. */
export async function unapproveDraft(
  admin: SupabaseClient,
  tenantSlug: string,
  dmId: string
): Promise<DecideResult> {
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
