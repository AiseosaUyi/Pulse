// Reads the sending mailbox (IMAP) for replies and bounces.
//
//   reply     -> logged as an inbound message (auto-analysis runs), prospect
//                marked replied, pending follow-ups cancelled, owner alerted
//   opt-out   -> same, and the prospect is closed
//   bounce    -> email marked failed, prospect email dropped, follow-ups cancelled
//   auto-reply (out of office) -> ignored, sequence continues
//
// Only messages newer than the last seen UID are read, so history is never
// re-processed. The first run starts from "now".

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailboxConfig } from "./mailbox";
import { setMailboxState } from "./mailbox";
import { isOptOut, stripQuotedReply } from "./templates";
import { normalizeEmail } from "@/lib/services/outreach-ledger";
import { recordInboundMessage } from "@/lib/services/outbound";

export interface ParsedMail {
  from: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  isAutoReply: boolean;
  bouncedRecipient: string | null;
}

export interface InboxReader {
  uidValidity: number;
  uidNext: number;
  fetchSince(afterUid: number, max: number): AsyncIterable<{ uid: number; source: Buffer }>;
  close(): Promise<void>;
}

export interface ReplyEvent {
  prospectId: string;
  from: string;
  subject: string;
  snippet: string;
  optOut: boolean;
}

const MAX_PER_RUN = 100;

export async function parseRawMail(source: Buffer): Promise<ParsedMail> {
  const { simpleParser } = await import("mailparser");
  const m = await simpleParser(source);
  const from = normalizeEmail(m.from?.value?.[0]?.address ?? "");
  const header = (k: string) => {
    const v = m.headers.get(k);
    return typeof v === "string" ? v : v ? String(v) : "";
  };
  const autoSubmitted = header("auto-submitted").toLowerCase();
  const subject = m.subject ?? "";
  const isAutoReply =
    (autoSubmitted !== "" && autoSubmitted !== "no") ||
    Boolean(header("x-autoreply") || header("x-autorespond")) ||
    /auto_reply|auto-reply/i.test(header("precedence")) ||
    /^(auto(matic)? reply|out of (the )?office|autoreply)/i.test(subject);

  const refs = m.references ? (Array.isArray(m.references) ? m.references : [m.references]) : [];
  const text = m.text ?? "";

  let bouncedRecipient: string | null = null;
  const contentType = header("content-type").toLowerCase();
  if (/mailer-daemon|postmaster/i.test(from) || contentType.includes("multipart/report")) {
    const haystack = [text, ...(m.attachments ?? []).map((a) => a.content?.toString("utf8") ?? "")].join("\n");
    const hit =
      /Final-Recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/i.exec(haystack) ??
      /Original-Recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/i.exec(haystack);
    bouncedRecipient = hit ? normalizeEmail(hit[1]) : null;
  }

  return {
    from,
    subject,
    text,
    inReplyTo: m.inReplyTo ?? null,
    references: refs,
    isAutoReply,
    bouncedRecipient,
  };
}

async function cancelPendingFollowUps(admin: SupabaseClient, tenantSlug: string, prospectId: string, reason: string) {
  await admin
    .from("outbound_dms")
    .update({ status: "cancelled", error: reason })
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", prospectId)
    .in("kind", ["follow_up_1", "follow_up_2"])
    .in("status", ["drafted", "approved"]);
}

/** Applies one parsed message. Returns a reply event when a human replied. */
export async function applyMail(
  admin: SupabaseClient,
  tenantSlug: string,
  mail: ParsedMail,
  ownAddresses: string[]
): Promise<{ kind: "reply"; event: ReplyEvent } | { kind: "bounce" | "ignored" | "error" }> {
  if (mail.bouncedRecipient) {
    const { data: dm } = await admin
      .from("outbound_dms")
      .select("id, prospect_id")
      .eq("tenant_slug", tenantSlug)
      .eq("send_via", "mailbox")
      .eq("to_email", mail.bouncedRecipient)
      .in("status", ["sent"])
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!dm) return { kind: "ignored" };
    await admin
      .from("outbound_dms")
      .update({ status: "failed", error: "Bounced: the address does not accept mail" })
      .eq("tenant_slug", tenantSlug)
      .eq("id", dm.id);
    await admin
      .from("prospects")
      .update({ email_status: "dropped" })
      .eq("tenant_slug", tenantSlug)
      .eq("id", dm.prospect_id);
    await cancelPendingFollowUps(admin, tenantSlug, dm.prospect_id as string, "Earlier email bounced");
    return { kind: "bounce" };
  }

  if (mail.isAutoReply || !mail.from || ownAddresses.includes(mail.from)) return { kind: "ignored" };

  // Match by thread headers first, then by sender address.
  const ids = [mail.inReplyTo, ...mail.references].filter((x): x is string => Boolean(x));
  type DmRef = { id: string; prospect_id: string };
  let dm = null as DmRef | null;
  if (ids.length) {
    const { data } = await admin
      .from("outbound_dms")
      .select("id, prospect_id")
      .eq("tenant_slug", tenantSlug)
      .in("message_id", ids)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    dm = (data as DmRef | null) ?? null;
  }
  if (!dm) {
    const { data } = await admin
      .from("outbound_dms")
      .select("id, prospect_id")
      .eq("tenant_slug", tenantSlug)
      .eq("send_via", "mailbox")
      .eq("to_email", mail.from)
      .in("status", ["sent", "replied"])
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    dm = (data as DmRef | null) ?? null;
  }
  if (!dm) return { kind: "ignored" };

  const body = stripQuotedReply(mail.text).slice(0, 8000) || "(empty reply)";
  const res = await recordInboundMessage(admin, tenantSlug, dm.prospect_id, {
    body,
    inReplyToDmId: dm.id,
  });
  // A failed write must be retried next run, not skipped (or follow-ups continue).
  if (!res.ok) return { kind: "error" };

  await cancelPendingFollowUps(admin, tenantSlug, dm.prospect_id, "They replied");

  // One-click List-Unsubscribe sends subject "unsubscribe" with an empty body.
  const optOut = isOptOut(body) || isOptOut(mail.subject);
  if (optOut) {
    await admin
      .from("prospects")
      .update({ status: "closed_lost" })
      .eq("tenant_slug", tenantSlug)
      .eq("id", dm.prospect_id);
  }

  return {
    kind: "reply",
    event: {
      prospectId: dm.prospect_id,
      from: mail.from,
      subject: mail.subject,
      snippet: body.slice(0, 200),
      optOut,
    },
  };
}

export async function openImapInbox(config: MailboxConfig, password: string): Promise<InboxReader> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: config.imapHost ?? config.smtpHost,
    port: config.imapPort,
    secure: config.imapPort === 993,
    auth: { user: config.smtpUser, pass: password },
    logger: false,
    connectionTimeout: 15_000,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const mb = client.mailbox;
  const info = mb && typeof mb === "object" ? mb : null;
  return {
    uidValidity: Number(info?.uidValidity ?? 0),
    uidNext: Number(info?.uidNext ?? 1),
    async *fetchSince(afterUid: number, max: number) {
      let n = 0;
      for await (const msg of client.fetch(`${afterUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= afterUid || !msg.source) continue;
        yield { uid: msg.uid, source: msg.source };
        if (++n >= max) break;
      }
    },
    async close() {
      lock.release();
      await client.logout().catch(() => undefined);
    },
  };
}

export async function pollReplies(
  admin: SupabaseClient,
  mailbox: MailboxConfig,
  reader: InboxReader
): Promise<{ replies: ReplyEvent[]; bounces: number; processed: number }> {
  const out = { replies: [] as ReplyEvent[], bounces: 0, processed: 0 };
  const tenantSlug = mailbox.tenantSlug;
  try {
    // New mailbox or the server reset its UIDs: start from now.
    if (mailbox.imapLastUid === null || mailbox.imapUidValidity !== reader.uidValidity) {
      await setMailboxState(admin, tenantSlug, {
        imap_uid_validity: reader.uidValidity,
        imap_last_uid: Math.max(0, reader.uidNext - 1),
        imap_checked_at: new Date().toISOString(),
      });
      return out;
    }

    const own = [mailbox.fromEmail, mailbox.replyTo, mailbox.smtpUser]
      .filter((x): x is string => Boolean(x))
      .map((x) => normalizeEmail(x));

    let lastUid = mailbox.imapLastUid;
    for await (const { uid, source } of reader.fetchSince(lastUid, MAX_PER_RUN)) {
      let mail: ParsedMail | null = null;
      try {
        mail = await parseRawMail(source);
      } catch (err) {
        // Unreadable message: skip it rather than block the inbox forever.
        console.warn("[autopilot] could not parse message", uid, err instanceof Error ? err.message : err);
      }
      if (mail) {
        let r: Awaited<ReturnType<typeof applyMail>>;
        try {
          r = await applyMail(admin, tenantSlug, mail, own);
        } catch {
          r = { kind: "error" };
        }
        // Database trouble: stop here and retry this message next run.
        if (r.kind === "error") break;
        if (r.kind === "reply") out.replies.push(r.event);
        if (r.kind === "bounce") out.bounces++;
      }
      out.processed++;
      lastUid = uid;
      await setMailboxState(admin, tenantSlug, { imap_last_uid: lastUid });
    }
    await setMailboxState(admin, tenantSlug, { imap_checked_at: new Date().toISOString() });
    return out;
  } finally {
    await reader.close();
  }
}
