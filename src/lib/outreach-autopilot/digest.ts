// The once-a-day approval email: "N emails are ready, review and approve".
// One signed link per email opens /approve/outreach/<token>, scoped to that
// tenant and to exactly the drafts listed in the digest. Links never act on
// a GET (mail scanners prefetch links): the page shows buttons that POST.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SignJWT, jwtVerify } from "jose";
import { sendBrevoEmail, getAppBaseUrl } from "@/lib/integrations/brevo";
import type { MailboxConfig } from "./mailbox";

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

export async function mintDigestToken(digestId: string, now = Date.now()): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error("APPROVAL_TOKEN_SECRET is not set");
  return new SignJWT({ sub: digestId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(Math.floor(now / 1000))
    .setIssuer("pulse")
    .setAudience(AUDIENCE)
    .setExpirationTime(Math.floor((now + TTL_MS) / 1000))
    .sign(key);
}

export async function verifyDigestToken(
  token: string
): Promise<{ ok: true; digestId: string } | { ok: false; reason: "expired" | "invalid" | "not_configured" }> {
  const key = secretKey();
  if (!key) return { ok: false, reason: "not_configured" };
  try {
    const { payload } = await jwtVerify(token, key, { issuer: "pulse", audience: AUDIENCE });
    return typeof payload.sub === "string" ? { ok: true, digestId: payload.sub } : { ok: false, reason: "invalid" };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return { ok: false, reason: code === "ERR_JWT_EXPIRED" ? "expired" : "invalid" };
  }
}

export interface DigestTarget {
  tenantSlug: string;
  dmIds: string[];
}

/** Resolves a token to its tenant and draft ids. */
export async function resolveDigest(
  admin: SupabaseClient,
  token: string
): Promise<{ ok: true; digest: DigestTarget } | { ok: false; reason: string }> {
  const v = await verifyDigestToken(token);
  if (!v.ok) return { ok: false, reason: v.reason };
  const { data } = await admin
    .from("outreach_digests")
    .select("tenant_slug, dm_ids, token_expires_at")
    .eq("id", v.digestId)
    .maybeSingle();
  if (!data) return { ok: false, reason: "invalid" };
  if (new Date(data.token_expires_at as string).getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, digest: { tenantSlug: data.tenant_slug as string, dmIds: (data.dm_ids as string[]) ?? [] } };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface DigestStats {
  sentYesterday: number;
  repliesWaiting: number;
  failed: number;
}

export function buildDigestEmail(opts: {
  tenantName: string;
  url: string;
  drafts: Array<{ subject: string | null; toEmail: string | null; kind: string; firstLine: string }>;
  stats: DigestStats;
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

  const statsLine = `Sent yesterday: ${opts.stats.sentYesterday} · New replies: ${opts.stats.repliesWaiting}${
    opts.stats.failed ? ` · Failed: ${opts.stats.failed}` : ""
  }`;

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
<h2 style="margin:0 0 8px">${n > 0 ? `${n} email${n === 1 ? "" : "s"} waiting for you` : "Outreach update"}</h2>
<p style="margin:0 0 16px;color:#444">${
    n > 0
      ? `${n - followUps} first email${n - followUps === 1 ? "" : "s"} and ${followUps} follow-up${followUps === 1 ? "" : "s"}. Nothing goes out until you approve it.`
      : "No drafts are waiting today."
  }</p>
${n > 0 ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">${lines}</table>` : ""}
${n > 5 ? `<p style="color:#666;margin:0 0 16px">and ${n - 5} more</p>` : ""}
${
    n > 0
      ? `<p><a href="${esc(opts.url)}" style="display:inline-block;background:#ad112c;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Review and approve</a></p>`
      : ""
  }
<p style="color:#666;font-size:13px;margin-top:24px">${esc(statsLine)}</p>
<p style="color:#999;font-size:12px">This link works for 72 hours and only for the drafts in this email.</p>
</body></html>`;

  const text = [
    n > 0 ? `${n} email(s) waiting for your approval. Nothing goes out until you approve.` : "No drafts today.",
    ...preview.map((d) => `- ${d.subject || "(no subject)"} -> ${d.toEmail || "?"}`),
    n > 0 ? `Review: ${opts.url}` : "",
    statsLine,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export async function sendDigestForTenant(
  admin: SupabaseClient,
  mailbox: MailboxConfig,
  tenantName: string,
  now: Date = new Date()
): Promise<{ sent: boolean; drafts: number; error?: string }> {
  const tenantSlug = mailbox.tenantSlug;

  const { data: drafts } = await admin
    .from("outbound_dms")
    .select("id, subject, to_email, kind, body")
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
    return { sent: false, drafts: 0 };
  }

  let url = `${getAppBaseUrl()}/autopilot`;
  if (list.length > 0) {
    const expires = new Date(now.getTime() + TTL_MS).toISOString();
    const { data: digest, error } = await admin
      .from("outreach_digests")
      .insert({
        tenant_slug: tenantSlug,
        dm_ids: list.map((d) => d.id),
        sent_to: mailbox.approverEmail,
        token_expires_at: expires,
      })
      .select("id")
      .single();
    if (error || !digest) return { sent: false, drafts: list.length, error: error?.message ?? "digest insert failed" };
    url = `${getAppBaseUrl()}/approve/outreach/${await mintDigestToken(digest.id as string, now.getTime())}`;
  }

  const email = buildDigestEmail({
    tenantName,
    url,
    stats,
    drafts: list.map((d) => ({
      subject: d.subject as string | null,
      toEmail: d.to_email as string | null,
      kind: d.kind as string,
      firstLine:
        String(d.body ?? "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(1, 2)[0]
          ?.slice(0, 140) ?? "",
    })),
  });

  const res = await sendBrevoEmail({
    to: { email: mailbox.approverEmail },
    subject: email.subject,
    htmlContent: email.html,
    textContent: email.text,
    tags: ["outreach-digest"],
  });
  return res.ok ? { sent: true, drafts: list.length } : { sent: false, drafts: list.length, error: res.error };
}
