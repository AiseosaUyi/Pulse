// Sends approved outreach email from the workspace's own mailbox.
//
// Rules (each one is a test in tests/unit/autopilot-sender.test.ts):
//   * Only status='approved' AND send_via='mailbox' rows are sent. That pair is
//     set only by a human approving (email link or in-app). Nothing else sends.
//   * Inside the send window, under the daily cap, a few per tick.
//   * Each row is claimed (approved -> sending) before sending, so two cron
//     runs can't double-send.
//   * Re-checked right before sending: prospect replied / handed off / email
//     dropped -> cancelled, not sent. An approved answer to a reply (kind
//     'reply') is sent to a replied lead; a closed lead still cancels it. A first email to a company the ledger
//     already has as CONTACTED -> cancelled.
//   * A row stuck in 'sending' (crash mid-send) is marked failed, never resent:
//     we can't know whether the server accepted it.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailboxConfig, MailTransport } from "./mailbox";
import { formatFrom } from "./mailbox";
import { isInSendWindow, localParts, perTickQuota, startOfLocalDay } from "./schedule";
import { messageIdDomain, textToHtml } from "./templates";
import {
  ledgerCheck,
  normalizeEmail,
  recordContactedFromProspect,
} from "@/lib/services/outreach-ledger";

export const TICKS_PER_HOUR = 2; // cron runs every 30 minutes
/** Hard ceiling per run, whatever the cap: keeps a run well inside the function time limit. */
export const MAX_SENDS_PER_TICK = 8;
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BLOCKING_PROSPECT_STATUSES = new Set([
  "replied",
  "handed_off",
  "closed_won",
  "closed_lost",
  "dismissed",
  "unqualified",
]);

const REPLY_BLOCKING_STATUSES = new Set(["closed_lost", "dismissed", "unqualified"]);

export interface SendTickResult {
  sent: number;
  failed: number;
  cancelled: number;
  skippedReason?: string;
}

export interface SenderDeps {
  now?: Date;
  timeZone: string;
  getTransport: () => Promise<MailTransport>;
  sleep?: (ms: number) => Promise<void>;
  /** Stop claiming new rows after this epoch-ms (time budget for the cron). */
  deadlineMs?: number;
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

const NETWORK_CODES = ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNRESET", "EDNS", "EPIPE", "ECONNREFUSED"];
const PRE_DATA_COMMAND = /^(CONN|EHLO|HELO|STARTTLS|AUTH|MAIL|RCPT)/i;

/**
 * What a failed send means:
 *  retry   - the server definitely did not take it (a 4xx reply, or the
 *            connection broke before the message body was sent)
 *  unknown - the connection broke during or after the body: it may have been
 *            delivered, so never resend automatically
 *  failed  - the server refused it (5xx)
 */
export function classifySendError(err: unknown): "retry" | "unknown" | "failed" {
  const e = err as { responseCode?: number; code?: string; command?: string };
  const code = Number(e?.responseCode);
  if (code >= 500) return "failed";
  if (code >= 400) return "retry";
  if (NETWORK_CODES.includes(String(e?.code ?? ""))) {
    return PRE_DATA_COMMAND.test(String(e?.command ?? "")) ? "retry" : "unknown";
  }
  return "unknown";
}

async function cancel(admin: SupabaseClient, tenantSlug: string, id: string, reason: string) {
  await admin
    .from("outbound_dms")
    .update({ status: "cancelled", error: reason, claimed_at: null })
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
}

export async function sendDueForTenant(
  admin: SupabaseClient,
  mailbox: MailboxConfig,
  deps: SenderDeps
): Promise<SendTickResult> {
  const now = deps.now ?? new Date();
  const tenantSlug = mailbox.tenantSlug;
  const result: SendTickResult = { sent: 0, failed: 0, cancelled: 0 };

  if (!mailbox.enabled) return { ...result, skippedReason: "mailbox disabled" };

  // Rows left in 'sending' by a crashed run: outcome unknown, never resend.
  await admin
    .from("outbound_dms")
    .update({ status: "failed", error: "Send outcome unknown (interrupted). Check the Sent folder before resending." })
    .eq("tenant_slug", tenantSlug)
    .eq("status", "sending")
    .lt("claimed_at", new Date(now.getTime() - STALE_CLAIM_MS).toISOString());

  if (!isInSendWindow(now, deps.timeZone, mailbox)) {
    return { ...result, skippedReason: "outside send window" };
  }

  const { count: sentToday } = await admin
    .from("outbound_dms")
    .select("id", { count: "exact", head: true })
    .eq("tenant_slug", tenantSlug)
    .eq("send_via", "mailbox")
    .gte("sent_at", startOfLocalDay(now, deps.timeZone).toISOString());

  const quota = perTickQuota({
    dailyCap: mailbox.dailyCap,
    sentToday: sentToday ?? 0,
    localHour: localParts(now, deps.timeZone).hour,
    sendWindowEnd: mailbox.sendWindowEnd,
    ticksPerHour: TICKS_PER_HOUR,
  });
  const limit = Math.min(quota, MAX_SENDS_PER_TICK);
  if (quota === 0) return { ...result, skippedReason: "daily cap reached" };

  const { data: due } = await admin
    .from("outbound_dms")
    .select("id, prospect_id, subject, body, to_email, kind, parent_dm_id, send_attempts")
    .eq("tenant_slug", tenantSlug)
    .eq("status", "approved")
    .eq("send_via", "mailbox")
    .lte("scheduled_send_at", now.toISOString())
    .order("scheduled_send_at", { ascending: true })
    .limit(limit);

  if (!due || due.length === 0) return { ...result, skippedReason: "nothing approved" };

  let transport: MailTransport | null = null;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  try {
    for (const [i, dm] of due.entries()) {
      if (deps.deadlineMs && Date.now() > deps.deadlineMs) break;

      // Claim: only one run can move approved -> sending. The Message-ID is
      // stored now, so a reply can be matched even if this run dies mid-send.
      const messageId = `<${randomUUID()}@${messageIdDomain(mailbox.fromEmail)}>`;
      const { data: claimed } = await admin
        .from("outbound_dms")
        .update({ status: "sending", claimed_at: now.toISOString(), message_id: messageId })
        .eq("tenant_slug", tenantSlug)
        .eq("id", dm.id)
        .eq("status", "approved")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      const { data: prospect } = await admin
        .from("prospects")
        .select("id, status, email, email_status, channel_handoff, website, handle, phone, company_name, display_name, run_id")
        .eq("tenant_slug", tenantSlug)
        .eq("id", dm.prospect_id)
        .maybeSingle();

      if (!prospect) {
        await cancel(admin, tenantSlug, dm.id, "Prospect not found");
        result.cancelled++;
        continue;
      }
      // An approved answer to their reply is the point of a "replied" lead;
      // only a closed lead blocks it.
      const blocking = dm.kind === "reply" ? REPLY_BLOCKING_STATUSES : BLOCKING_PROSPECT_STATUSES;
      if (blocking.has(prospect.status as string)) {
        await cancel(admin, tenantSlug, dm.id, `Not sent: prospect is ${prospect.status}`);
        result.cancelled++;
        continue;
      }
      if (prospect.channel_handoff && prospect.channel_handoff !== "none") {
        await cancel(admin, tenantSlug, dm.id, `Not sent: handed off to ${prospect.channel_handoff}`);
        result.cancelled++;
        continue;
      }
      if (prospect.email_status === "dropped") {
        await cancel(admin, tenantSlug, dm.id, "Not sent: email bounced or failed verification");
        result.cancelled++;
        continue;
      }

      const to = normalizeEmail(dm.to_email as string);
      if (!to || !EMAIL_RE.test(to)) {
        await cancel(admin, tenantSlug, dm.id, "Not sent: no valid recipient address");
        result.cancelled++;
        continue;
      }

      if (dm.kind === "cold_open") {
        const hit = await ledgerCheck(admin, tenantSlug, {
          email: to,
          domain: prospect.website as string | null,
        });
        if (hit.inLedger && hit.entry) {
          await cancel(
            admin,
            tenantSlug,
            dm.id,
            `Not sent: ${hit.entry.keyType} ${hit.entry.key} is already ${hit.entry.kind} in the ledger`
          );
          result.cancelled++;
          continue;
        }
      }

      let parentMessageId: string | null = null;
      if (dm.parent_dm_id) {
        const { data: parent } = await admin
          .from("outbound_dms")
          .select("message_id, status")
          .eq("tenant_slug", tenantSlug)
          .eq("id", dm.parent_dm_id)
          .maybeSingle();
        if (parent?.status === "replied" && dm.kind !== "reply") {
          await cancel(admin, tenantSlug, dm.id, "Not sent: they already replied");
          result.cancelled++;
          continue;
        }
        parentMessageId = (parent?.message_id as string) ?? null;
      }

      const text = String(dm.body ?? "").trim();
      const subject = String(dm.subject ?? "").trim() || "Hello";

      try {
        transport ??= await deps.getTransport();
        if (i > 0) await sleep(3000 + Math.floor(Math.random() * 5000));
        await transport.sendMail({
          from: formatFrom(mailbox),
          to,
          subject,
          text,
          html: textToHtml(text),
          replyTo: mailbox.replyTo ?? undefined,
          messageId,
          ...(parentMessageId ? { inReplyTo: parentMessageId, references: [parentMessageId] } : {}),
          headers: {
            "List-Unsubscribe": `<mailto:${mailbox.replyTo ?? mailbox.fromEmail}?subject=unsubscribe>`,
          },
        });
      } catch (err) {
        const attempts = Number(dm.send_attempts ?? 0) + 1;
        const kind = classifySendError(err);
        const retry = kind === "retry" && attempts < MAX_ATTEMPTS;
        const raw = err instanceof Error ? err.message.slice(0, 250) : "Send failed";
        const message =
          kind === "unknown" ? `Send outcome unknown (${raw}). Check the Sent folder before resending.` : raw;
        await admin
          .from("outbound_dms")
          .update({
            status: retry ? "approved" : "failed",
            send_attempts: attempts,
            error: message,
            claimed_at: null,
            ...(retry ? { scheduled_send_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString() } : {}),
          })
          .eq("tenant_slug", tenantSlug)
          .eq("id", dm.id);
        if (!retry) result.failed++;
        continue;
      }

      const sentAt = new Date().toISOString();
      await admin
        .from("outbound_dms")
        .update({ status: "sent", sent_at: sentAt, message_id: messageId, error: null, claimed_at: null })
        .eq("tenant_slug", tenantSlug)
        .eq("id", dm.id);

      if (dm.kind === "cold_open") {
        await admin
          .from("prospects")
          .update({ status: "sent", last_touched_at: sentAt })
          .eq("tenant_slug", tenantSlug)
          .eq("id", prospect.id)
          .in("status", ["new", "qualifying", "qualified", "drafted", "approved"]);
      } else {
        await admin
          .from("prospects")
          .update({ last_touched_at: sentAt })
          .eq("tenant_slug", tenantSlug)
          .eq("id", prospect.id);
      }

      await recordContactedFromProspect(
        admin,
        tenantSlug,
        {
          email: to,
          handle: prospect.handle as string | null,
          phone: prospect.phone as string | null,
          website: prospect.website as string | null,
          companyName: (prospect.company_name || prospect.display_name) as string | null,
          runId: prospect.run_id as string | null,
        },
        `Autopilot email sent (${dm.kind})`
      );
      result.sent++;
    }
  } finally {
    transport?.close?.();
  }

  return result;
}
