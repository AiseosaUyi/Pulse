// One autopilot pass for one workspace. Called by the outreach-autopilot cron
// every 30 minutes. Each step is isolated: a failure in one (say IMAP is down)
// is recorded on the mailbox and the other steps still run.
//
//   1. read replies and bounces        (every pass)
//   2. once a day at the digest hour:  draft new first emails, draft due
//                                      follow-ups, email the owner to approve
//   3. send approved email             (every pass, inside the window)

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMailboxWithSecret, createSmtpTransport, setMailboxState } from "./mailbox";
import { openImapInbox, pollReplies, type ReplyEvent } from "./replies";
import { draftDueFollowUps } from "./followups";
import { sendDigestForTenant } from "./digest";
import { sendDueForTenant, type SendTickResult } from "./sender";
import { isDigestDue } from "./schedule";
import { composeAndSaveDrafts, getOutreachConfig } from "@/lib/services/outreach-composition";
import { sendBrevoEmail, getAppBaseUrl } from "@/lib/integrations/brevo";

export interface TenantPassResult {
  tenantSlug: string;
  replies: number;
  bounces: number;
  composed: number;
  followUps: number;
  digestSent: boolean;
  send: SendTickResult | null;
  errors: string[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function alertReplies(approverEmail: string, tenantName: string, replies: ReplyEvent[]) {
  if (!replies.length) return;
  const items = replies
    .map(
      (r) =>
        `<li style="margin-bottom:12px"><strong>${esc(r.from)}</strong>${r.optOut ? " (asked to stop)" : ""}<br>` +
        `<span style="color:#444">${esc(r.snippet)}</span></li>`
    )
    .join("");
  await sendBrevoEmail({
    to: { email: approverEmail },
    subject: `${tenantName}: ${replies.length} new repl${replies.length === 1 ? "y" : "ies"}`,
    htmlContent: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">New replies</h2><ul style="padding-left:18px">${items}</ul>
<p>Follow-ups to these people have been stopped.</p>
<p><a href="${getAppBaseUrl()}/autopilot" style="color:#ad112c">Open Autopilot</a></p></body></html>`,
    textContent: replies.map((r) => `${r.from}: ${r.snippet}`).join("\n\n"),
    tags: ["outreach-replies"],
  });
}

/** New verified prospects with no email drafted yet, oldest first. */
async function prospectsToCompose(admin: SupabaseClient, tenantSlug: string, limit: number): Promise<string[]> {
  const { data: candidates } = await admin
    .from("prospects")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("email_status", "verified")
    .in("status", ["new", "qualified"])
    .order("created_at", { ascending: true })
    .limit(limit * 3);
  const ids = (candidates ?? []).map((c) => c.id as string);
  if (!ids.length) return [];
  const { data: existing } = await admin
    .from("outbound_dms")
    .select("prospect_id")
    .eq("tenant_slug", tenantSlug)
    .in("prospect_id", ids);
  const has = new Set((existing ?? []).map((e) => e.prospect_id as string));
  return ids.filter((id) => !has.has(id)).slice(0, limit);
}

function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return "Africa/Lagos";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "Africa/Lagos";
  }
}

export async function runAutopilotForTenant(
  admin: SupabaseClient,
  tenantSlug: string,
  now: Date = new Date(),
  deadlineMs?: number
): Promise<TenantPassResult> {
  const res: TenantPassResult = {
    tenantSlug,
    replies: 0,
    bounces: 0,
    composed: 0,
    followUps: 0,
    digestSent: false,
    send: null,
    errors: [],
  };

  const box = await getMailboxWithSecret(admin, tenantSlug);
  if (!box || !box.config.enabled) return res;
  const { config, password } = box;

  const { data: tenant } = await admin.from("tenants").select("name, timezone").eq("slug", tenantSlug).maybeSingle();
  const tenantName = (tenant?.name as string) ?? tenantSlug;
  const timeZone = validTimeZone(tenant?.timezone as string | null);

  // 1. Replies and bounces.
  if (config.imapHost) {
    try {
      const reader = await openImapInbox(config, password);
      const r = await pollReplies(admin, config, reader);
      res.replies = r.replies.length;
      res.bounces = r.bounces;
      await alertReplies(config.approverEmail, tenantName, r.replies);
    } catch (err) {
      res.errors.push(`replies: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Daily: compose, follow-ups, digest.
  if (isDigestDue(now, timeZone, config.digestHour, config.lastDigestAt)) {
    const outreach = await getOutreachConfig(admin, tenantSlug);

    if (config.autoCompose && outreach) {
      try {
        const ids = await prospectsToCompose(admin, tenantSlug, config.dailyCap);
        if (ids.length) {
          const c = await composeAndSaveDrafts(admin, tenantSlug, { prospectIds: ids });
          res.composed = c.totalDrafts;
        }
      } catch (err) {
        res.errors.push(`compose: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (outreach) {
      try {
        const { data: copyRow } = await admin
          .from("outreach_configs")
          .select("follow_up_1_body, follow_up_2_body, signature")
          .eq("workspace", tenantSlug)
          .maybeSingle();
        if (copyRow) {
          const f = await draftDueFollowUps(
            admin,
            config,
            {
              followUp1Body: copyRow.follow_up_1_body as string,
              followUp2Body: copyRow.follow_up_2_body as string,
              signature: copyRow.signature as string,
            },
            now
          );
          res.followUps = f.drafted;
        }
      } catch (err) {
        res.errors.push(`follow-ups: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const d = await sendDigestForTenant(admin, config, tenantName, now);
      res.digestSent = d.sent;
      if (d.error) res.errors.push(`digest: ${d.error}`);
      // Mark the day done even when there was nothing to report, so the
      // digest doesn't re-run every 30 minutes. A failed send retries.
      if (!d.error) await setMailboxState(admin, tenantSlug, { last_digest_at: now.toISOString() });
    } catch (err) {
      res.errors.push(`digest: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Send approved email.
  try {
    res.send = await sendDueForTenant(admin, config, {
      now,
      timeZone,
      getTransport: () => createSmtpTransport(config, password),
      deadlineMs,
    });
  } catch (err) {
    res.errors.push(`send: ${err instanceof Error ? err.message : String(err)}`);
  }

  await setMailboxState(admin, tenantSlug, { last_error: res.errors.length ? res.errors.join(" | ").slice(0, 1000) : null });
  return res;
}
