// One autopilot pass for one workspace. Called by the outreach-autopilot cron
// every 30 minutes. Each step is isolated: a failure in one (say IMAP is down)
// is recorded on the mailbox and the other steps still run.
//
//   1. read replies and bounces,       (every pass)
//      draft an answer to each reply and email the approver at once
//   2. once a day at the digest hour:  draft new first emails, draft due
//                                      follow-ups, email the owner to approve
//   3. send approved email             (every pass, inside the window)

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMailboxWithSecret, createSmtpTransport, setMailboxState, type MailboxConfig } from "./mailbox";
import { openImapInbox, pollReplies, type ReplyEvent } from "./replies";
import { draftDueFollowUps } from "./followups";
import { findEmailsForTenant } from "./enrich";
import { sendDigestForTenant } from "./digest";
import { draftRepliesForEvents, type ReplyDraftOutcome } from "./reply-draft";
import { makeAiReplyWriter } from "./reply-writer";
import { sendReplyAlerts } from "./reply-alerts";
import { makeAiPersonalizer } from "./personalize";
import { sendDueForTenant, type SendTickResult } from "./sender";
import { isDigestDue } from "./schedule";
import { composeAndSaveDrafts, getOutreachConfig } from "@/lib/services/outreach-composition";

export interface TenantPassResult {
  tenantSlug: string;
  replies: number;
  /** Answers drafted for those replies, waiting for approval. */
  replyDrafts: number;
  bounces: number;
  emailsFound: number;
  composed: number;
  followUps: number;
  digestSent: boolean;
  send: SendTickResult | null;
  errors: string[];
}

/**
 * Draft answers to this pass's replies, then email each approver (the lead
 * owner, else the workspace approver) once with their replies, the drafted
 * answers and a one-tap approval link scoped to those drafts.
 */
async function handleReplies(
  admin: SupabaseClient,
  config: MailboxConfig,
  tenantName: string,
  replies: ReplyEvent[],
  now: Date
): Promise<{ drafted: number; error?: string }> {
  if (!replies.length) return { drafted: 0 };
  let error: string | undefined;

  let outcomes: ReplyDraftOutcome[] = [];
  try {
    const { data: copy } = await admin
      .from("outreach_configs")
      .select("signature")
      .eq("workspace", config.tenantSlug)
      .maybeSingle();
    const writer = await makeAiReplyWriter(config.tenantSlug);
    outcomes = await draftRepliesForEvents(admin, config, replies, writer, (copy?.signature as string) ?? "");
  } catch (err) {
    error = `reply drafts: ${err instanceof Error ? err.message : String(err)}`;
  }

  const dmIds = outcomes.map((o) => o.dmId).filter((x): x is string => Boolean(x));
  try {
    const alerts = await sendReplyAlerts(admin, config, tenantName, replies, outcomes, now);
    if (alerts.errors.length) error = [error, ...alerts.errors].filter(Boolean).join(" | ");
  } catch (err) {
    error = [error, `reply alert: ${err instanceof Error ? err.message : String(err)}`].filter(Boolean).join(" | ");
  }
  return { drafted: dmIds.length, error };
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
    replyDrafts: 0,
    bounces: 0,
    emailsFound: 0,
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
      const h = await handleReplies(admin, config, tenantName, r.replies, now);
      res.replyDrafts = h.drafted;
      if (h.error) res.errors.push(h.error);
    } catch (err) {
      res.errors.push(`replies: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Daily: compose, follow-ups, digest.
  if (isDigestDue(now, timeZone, config.digestHour, config.lastDigestAt)) {
    const outreach = await getOutreachConfig(admin, tenantSlug);

    // Find emails for leads that have none, so there is someone to write to.
    if (config.autoCompose) {
      try {
        const e = await findEmailsForTenant(admin, tenantSlug, {
          limit: 25,
          searchBudget: 15,
          now,
          deadlineMs: deadlineMs ? deadlineMs - 120_000 : Date.now() + 120_000,
        });
        res.emailsFound = e.found;
      } catch (err) {
        res.errors.push(`find emails: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (config.autoCompose && outreach) {
      try {
        const ids = await prospectsToCompose(admin, tenantSlug, config.dailyCap);
        if (ids.length) {
          // First emails written from the lead's own website and bio.
          const personalize = await makeAiPersonalizer(tenantSlug, {
            tenantName,
            rules: { ideaPrefix: outreach.ideaPrefix, wordLimits: outreach.wordLimits },
            deadlineMs: deadlineMs ? deadlineMs - 60_000 : Date.now() + 150_000,
          }).catch(() => null);
          const c = await composeAndSaveDrafts(admin, tenantSlug, { prospectIds: ids, personalize });
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
      // Some approvers got theirs: keep the day marked done so nobody is
      // emailed twice. The drafts stay in /autopilot and in tomorrow's digest.
      for (const w of d.warnings ?? []) res.errors.push(`digest: ${w}`);
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
