// The once-a-day approval email: "N emails are ready, review and approve".
// Drafts are split by approver: the teammate who owns the lead, or the
// workspace approver when the lead has no usable owner (see approvers.ts).
// Each approver gets one email with one signed link that opens
// /approve/outreach/<token>, scoped to that tenant and to exactly the drafts
// listed in that email. Links never act on a GET (mail scanners prefetch
// links): the page shows buttons that POST.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SignJWT, jwtVerify } from "jose";
import { sendBrevoEmail, getAppBaseUrl } from "@/lib/integrations/brevo";
import type { MailboxConfig } from "./mailbox";
import { groupByApprover, resolveApprovers, type AuthEmailLookup } from "./approvers";

const TTL_MS = 72 * 60 * 60 * 1000;
const AUDIENCE = "pulse-outreach-digest";
const MAX_PER_DIGEST = 60;

function secretKey(): Uint8Array | null {
  const s = process.env.APPROVAL_TOKEN_SECRET;
  return s ? new TextEncoder().encode(s) : null;
}

export function isDigestConfigured(): boolean {
  return Boolean(process.env.APPROVAL_TOKEN_SECRET);
}

/**
 * `userId` (optional) is the lead owner the link was sent to. It is signed
 * into the token so the approval is recorded against that person, and the
 * link stops working if they leave the workspace.
 */
export async function mintDigestToken(digestId: string, now = Date.now(), userId?: string | null): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error("APPROVAL_TOKEN_SECRET is not set");
  return new SignJWT(userId ? { sub: digestId, uid: userId } : { sub: digestId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(Math.floor(now / 1000))
    .setIssuer("pulse")
    .setAudience(AUDIENCE)
    .setExpirationTime(Math.floor((now + TTL_MS) / 1000))
    .sign(key);
}

export async function verifyDigestToken(
  token: string
): Promise<
  { ok: true; digestId: string; userId?: string } | { ok: false; reason: "expired" | "invalid" | "not_configured" }
> {
  const key = secretKey();
  if (!key) return { ok: false, reason: "not_configured" };
  try {
    const { payload } = await jwtVerify(token, key, { issuer: "pulse", audience: AUDIENCE });
    if (typeof payload.sub !== "string") return { ok: false, reason: "invalid" };
    if (payload.uid !== undefined && typeof payload.uid !== "string") return { ok: false, reason: "invalid" };
    return typeof payload.uid === "string"
      ? { ok: true, digestId: payload.sub, userId: payload.uid }
      : { ok: true, digestId: payload.sub };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return { ok: false, reason: code === "ERR_JWT_EXPIRED" ? "expired" : "invalid" };
  }
}

/**
 * A signed approval link scoped to exactly these drafts, valid 72 hours.
 * Used by the daily digest and the instant "new replies" email. Pass the
 * lead owner's `approverUserId` when the link goes to them, so the audit
 * records who approved.
 */
export async function createApprovalLink(
  admin: SupabaseClient,
  tenantSlug: string,
  approverEmail: string,
  dmIds: string[],
  now: Date = new Date(),
  approverUserId: string | null = null
): Promise<{ url: string } | { error: string }> {
  const { data: digest, error } = await admin
    .from("outreach_digests")
    .insert({
      tenant_slug: tenantSlug,
      dm_ids: dmIds,
      sent_to: approverEmail,
      token_expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !digest) return { error: error?.message ?? "digest insert failed" };
  const token = await mintDigestToken(digest.id as string, now.getTime(), approverUserId);
  return { url: `${getAppBaseUrl()}/approve/outreach/${token}` };
}

export interface DigestTarget {
  tenantSlug: string;
  dmIds: string[];
  /** Who the link was emailed to. */
  sentTo: string;
  /** The lead owner's auth user id, when the link went to a lead owner. */
  approverUserId: string | null;
}

/**
 * Resolves a token to its tenant and draft ids. A link sent to a lead owner
 * only works while that person is still a (non-support) member of the tenant.
 */
export async function resolveDigest(
  admin: SupabaseClient,
  token: string
): Promise<{ ok: true; digest: DigestTarget } | { ok: false; reason: string }> {
  const v = await verifyDigestToken(token);
  if (!v.ok) return { ok: false, reason: v.reason };
  const { data } = await admin
    .from("outreach_digests")
    .select("tenant_slug, dm_ids, sent_to, token_expires_at")
    .eq("id", v.digestId)
    .maybeSingle();
  if (!data) return { ok: false, reason: "invalid" };
  if (new Date(data.token_expires_at as string).getTime() < Date.now()) return { ok: false, reason: "expired" };
  const tenantSlug = data.tenant_slug as string;
  const approverUserId = v.userId ?? null;
  if (approverUserId) {
    const { data: m } = await admin
      .from("memberships")
      .select("role")
      .eq("tenant_slug", tenantSlug)
      .eq("user_id", approverUserId)
      .maybeSingle();
    if (!m || !m.role || m.role === "support") return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    digest: {
      tenantSlug,
      dmIds: (data.dm_ids as string[]) ?? [],
      sentTo: (data.sent_to as string) ?? "",
      approverUserId,
    },
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface DigestStats {
  sentYesterday: number;
  repliesWaiting: number;
  failed: number;
}

/** "3 drafts went to their lead owners." or "" for zero. Pure. */
export function routedLine(n: number, noun: "draft" | "reply"): string {
  if (n <= 0) return "";
  const word = noun === "draft" ? (n === 1 ? "draft" : "drafts") : n === 1 ? "reply" : "replies";
  return `${n} ${word} went to ${n === 1 ? "its lead owner" : "their lead owners"}.`;
}

export function buildDigestEmail(opts: {
  tenantName: string;
  url: string;
  drafts: Array<{ subject: string | null; toEmail: string | null; kind: string; firstLine: string }>;
  /** Workspace numbers. Only the workspace approver gets them. */
  stats?: DigestStats | null;
  /** Drafts sent to lead owners instead (workspace approver only). */
  routedToOwners?: number;
}): { subject: string; html: string; text: string } {
  const n = opts.drafts.length;
  const followUps = opts.drafts.filter((d) => d.kind !== "cold_open").length;
  const subject =
    n > 0
      ? `${opts.tenantName}: ${n} email${n === 1 ? "" : "s"} ready for your OK`
      : `${opts.tenantName}: outreach update`;

  const preview = opts.drafts.slice(0, 5);
  const lines = preview
    .map(
      (d) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><strong>${esc(d.subject || "(no subject)")}</strong>` +
        `<br><span style="color:#666">to ${esc(d.toEmail || "?")}${d.kind !== "cold_open" ? " · follow-up" : ""}</span>` +
        `<br><span style="color:#444">${esc(d.firstLine)}</span></td></tr>`
    )
    .join("");

  const statsLine = opts.stats
    ? `Sent yesterday: ${opts.stats.sentYesterday} · New replies: ${opts.stats.repliesWaiting}${
        opts.stats.failed ? ` · Failed: ${opts.stats.failed}` : ""
      }`
    : "";
  const routed = routedLine(opts.routedToOwners ?? 0, "draft");

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
<h2 style="margin:0 0 8px">${n > 0 ? `${n} email${n === 1 ? "" : "s"} waiting for you` : "Outreach update"}</h2>
<p style="margin:0 0 16px;color:#444">${
    n > 0
      ? `${n - followUps} first email${n - followUps === 1 ? "" : "s"} and ${followUps} follow-up${followUps === 1 ? "" : "s"}. Nothing goes out until you approve it.`
      : "No drafts are waiting for you today."
  }</p>
${n > 0 ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">${lines}</table>` : ""}
${n > 5 ? `<p style="color:#666;margin:0 0 16px">and ${n - 5} more</p>` : ""}
${
    n > 0
      ? `<p><a href="${esc(opts.url)}" style="display:inline-block;background:#ad112c;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Review and approve</a></p>`
      : ""
  }
${routed ? `<p style="color:#444;margin:16px 0 0">${esc(routed)}</p>` : ""}
${statsLine ? `<p style="color:#666;font-size:13px;margin-top:24px">${esc(statsLine)}</p>` : ""}
${n > 0 ? `<p style="color:#999;font-size:12px">This link works for 72 hours and only for the drafts in this email.</p>` : ""}
</body></html>`;

  const text = [
    n > 0 ? `${n} email(s) waiting for your approval. Nothing goes out until you approve.` : "No drafts for you today.",
    ...preview.map((d) => `- ${d.subject || "(no subject)"} -> ${d.toEmail || "?"}`),
    n > 0 ? `Review: ${opts.url}` : "",
    routed,
    statsLine,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

function firstLineOf(body: unknown): string {
  return (
    String(body ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(1, 2)[0]
      ?.slice(0, 140) ?? ""
  );
}

export interface DigestResult {
  /** At least one approval email went out. */
  sent: boolean;
  drafts: number;
  /** Emails sent, one per approver. */
  emails: number;
  /**
   * Set only when nothing could be sent, so the runner retries the digest on
   * the next pass. Partial failures go in `warnings` instead: retrying would
   * email the people who already got theirs a second time.
   */
  error?: string;
  warnings?: string[];
}

export async function sendDigestForTenant(
  admin: SupabaseClient,
  mailbox: MailboxConfig,
  tenantName: string,
  now: Date = new Date(),
  lookupAuthEmail?: AuthEmailLookup
): Promise<DigestResult> {
  const tenantSlug = mailbox.tenantSlug;

  const { data: drafts } = await admin
    .from("outbound_dms")
    .select("id, prospect_id, subject, to_email, kind, body")
    .eq("tenant_slug", tenantSlug)
    .eq("status", "drafted")
    .not("to_email", "is", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_DIGEST);

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count: sentYesterday }, { count: failed }, { count: repliesWaiting }] = await Promise.all([
    admin
      .from("outbound_dms")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", tenantSlug)
      .eq("send_via", "mailbox")
      .gte("sent_at", dayAgo),
    admin
      .from("outbound_dms")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", tenantSlug)
      .eq("send_via", "mailbox")
      .eq("status", "failed")
      .gte("updated_at", dayAgo),
    admin
      .from("inbound_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", tenantSlug)
      .not("prospect_id", "is", null)
      .gte("created_at", dayAgo),
  ]);

  const list = drafts ?? [];
  const stats = { sentYesterday: sentYesterday ?? 0, failed: failed ?? 0, repliesWaiting: repliesWaiting ?? 0 };

  // Nothing to approve and nothing to report: stay quiet.
  if (list.length === 0 && stats.repliesWaiting === 0 && stats.failed === 0) {
    return { sent: false, drafts: 0, emails: 0 };
  }

  const approvers = await resolveApprovers(
    admin,
    tenantSlug,
    list.map((d) => d.prospect_id as string),
    mailbox.approverEmail,
    lookupAuthEmail
  );
  const workspaceEmail = mailbox.approverEmail.trim().toLowerCase();
  const groups = groupByApprover(list, (d) => d.prospect_id as string, approvers, mailbox.approverEmail);
  const routedToOwners = groups
    .filter((g) => g.approver.email !== workspaceEmail)
    .reduce((n, g) => n + g.items.length, 0);

  // The workspace approver always gets an email (stats + the routed line),
  // even with no drafts of their own.
  if (!groups.some((g) => g.approver.email === workspaceEmail)) {
    groups.push({ approver: { email: workspaceEmail, userId: null, isOwner: false }, items: [] });
  }

  let emails = 0;
  const warnings: string[] = [];
  for (const g of groups) {
    const isWorkspace = g.approver.email === workspaceEmail;
    let url = `${getAppBaseUrl()}/autopilot`;
    if (g.items.length > 0) {
      const link = await createApprovalLink(
        admin,
        tenantSlug,
        g.approver.email,
        g.items.map((d) => d.id as string),
        now,
        g.approver.userId
      ).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      if ("error" in link) {
        warnings.push(`link for ${g.approver.email}: ${link.error}`);
        continue;
      }
      url = link.url;
    }

    const email = buildDigestEmail({
      tenantName,
      url,
      stats: isWorkspace ? stats : null,
      routedToOwners: isWorkspace ? routedToOwners : 0,
      drafts: g.items.map((d) => ({
        subject: d.subject as string | null,
        toEmail: d.to_email as string | null,
        kind: d.kind as string,
        firstLine: firstLineOf(d.body),
      })),
    });

    const res = await sendBrevoEmail({
      to: { email: g.approver.email },
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      tags: ["outreach-digest"],
    });
    if (res.ok) emails++;
    else warnings.push(`send to ${g.approver.email}: ${res.error ?? "failed"}`);
  }

  if (emails === 0) return { sent: false, drafts: list.length, emails: 0, error: warnings.join("; ") || "send failed" };
  return warnings.length
    ? { sent: true, drafts: list.length, emails, warnings }
    : { sent: true, drafts: list.length, emails };
}
