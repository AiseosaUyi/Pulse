// When someone replies, draft our answer in the same email thread and put it
// in the approval queue. Drafts only: the answer goes out after a person
// approves it, through the same sender as every other email.
//
//   opt-out              -> no answer (they asked us to stop)
//   lead closed / handed off to another channel -> no answer
//   already answered this message (sending or sent) -> no new draft
//   a second reply before our answer went out -> that answer goes back to
//   draft and is rewritten (an approval of the old text no longer applies)
//
// The writer (the AI call) is passed in, so this file has no model imports.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailboxConfig } from "./mailbox";
import type { ReplyEvent } from "./replies";
import { replySubject } from "./templates";
import { finishReplyBody, replyNotes, type ReplyIntent, type ReplyWriter } from "./reply-copy";
import { mapWithConcurrency } from "@/lib/utils/concurrency";

const NO_ANSWER_STATUSES = new Set(["closed_lost", "dismissed", "unqualified"]);
const MAX_PER_PASS = 10;

export interface ReplyDraftOutcome {
  event: ReplyEvent;
  company: string | null;
  intent: ReplyIntent | null;
  dmId: string | null;
  draft: string | null;
}

async function loadThread(admin: SupabaseClient, tenantSlug: string, prospectId: string) {
  const [out, inn] = await Promise.all([
    admin
      .from("outbound_dms")
      .select("body, sent_at")
      .eq("tenant_slug", tenantSlug)
      .eq("prospect_id", prospectId)
      .in("status", ["sent", "replied"])
      .order("sent_at", { ascending: false })
      .limit(6),
    admin
      .from("inbound_messages")
      .select("body, received_at")
      .eq("tenant_slug", tenantSlug)
      .eq("prospect_id", prospectId)
      .order("received_at", { ascending: false })
      .limit(6),
  ]);
  const msgs = [
    ...(out.data ?? []).map((m) => ({ direction: "outbound" as const, body: String(m.body ?? ""), at: String(m.sent_at ?? "") })),
    ...(inn.data ?? []).map((m) => ({ direction: "inbound" as const, body: String(m.body ?? ""), at: String(m.received_at ?? "") })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return msgs.map(({ direction, body }) => ({ direction, body: body.slice(0, 3000) }));
}

async function draftOne(
  admin: SupabaseClient,
  mailbox: MailboxConfig,
  ev: ReplyEvent,
  writer: ReplyWriter | null,
  signature: string
): Promise<ReplyDraftOutcome> {
  const tenantSlug = mailbox.tenantSlug;
  const none: ReplyDraftOutcome = { event: ev, company: null, intent: null, dmId: null, draft: null };

  const { data: p } = await admin
    .from("prospects")
    .select("id, status, channel_handoff, verified_name, display_name, company_name, handle")
    .eq("tenant_slug", tenantSlug)
    .eq("id", ev.prospectId)
    .maybeSingle();
  if (!p) return none;
  const company = ((p.company_name as string) || (p.display_name as string) || (p.handle as string) || "").trim() || null;
  const base = { ...none, company };
  if (ev.optOut || !writer) return base;
  if (NO_ANSWER_STATUSES.has(p.status as string)) return base;
  if (p.channel_handoff && p.channel_handoff !== "none") return base;

  // Answer in the thread of the latest email we sent them.
  const { data: parent } = await admin
    .from("outbound_dms")
    .select("id, subject")
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", p.id)
    .eq("send_via", "mailbox")
    .in("status", ["sent", "replied"])
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!parent) return base;

  const { data: existing } = await admin
    .from("outbound_dms")
    .select("id, status")
    .eq("tenant_slug", tenantSlug)
    .eq("parent_dm_id", parent.id)
    .eq("kind", "reply")
    .maybeSingle();
  // Approved but not yet sent: their new message makes it stale, so it is
  // pulled back to a draft and rewritten. Sending or sent: leave it.
  if (existing && existing.status !== "drafted" && existing.status !== "approved") return base;

  const thread = await loadThread(admin, tenantSlug, p.id as string);
  const latest = [...thread].reverse().find((m) => m.direction === "inbound")?.body ?? ev.snippet;

  const result = await writer({
    tenantSlug,
    senderName: mailbox.fromName || mailbox.fromEmail,
    signature,
    prospectName: ((p.verified_name as string) || "").trim(),
    company: company ?? "",
    thread,
    latest,
  }).catch(() => null);
  if (!result) return base;
  if (!result.body) return { ...base, intent: result.intent };

  const body = finishReplyBody(result.body, signature);
  const notes = replyNotes(result, latest);

  if (existing) {
    const { data } = await admin
      .from("outbound_dms")
      .update({
        body,
        lint_warnings: notes,
        to_email: ev.from,
        status: "drafted",
        send_via: null,
        approved_at: null,
        approved_via: null,
        approved_by: null,
        scheduled_send_at: null,
      })
      .eq("tenant_slug", tenantSlug)
      .eq("id", existing.id)
      .in("status", ["drafted", "approved"])
      .select("id")
      .maybeSingle();
    return data ? { ...base, intent: result.intent, dmId: existing.id as string, draft: body } : { ...base, intent: result.intent };
  }

  const { data: last } = await admin
    .from("outbound_dms")
    .select("version")
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", p.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: row, error } = await admin
    .from("outbound_dms")
    .insert({
      tenant_slug: tenantSlug,
      prospect_id: p.id,
      version: ((last?.version as number) ?? 0) + 1,
      kind: "reply",
      parent_dm_id: parent.id,
      subject: replySubject(parent.subject as string | null),
      to_email: ev.from,
      body,
      lint_warnings: notes,
      status: "drafted",
      generator_model: "autopilot-reply",
      generator_cost_usd: 0,
    })
    .select("id")
    .single();
  if (error || !row) return { ...base, intent: result.intent };
  return { ...base, intent: result.intent, dmId: row.id as string, draft: body };
}

/** Drafts answers for this pass's replies, a few at a time. Never throws per reply. */
export async function draftRepliesForEvents(
  admin: SupabaseClient,
  mailbox: MailboxConfig,
  events: ReplyEvent[],
  writer: ReplyWriter | null,
  signature: string
): Promise<ReplyDraftOutcome[]> {
  // One draft per lead per pass, using their latest message.
  const byLead = new Map<string, ReplyEvent>();
  for (const ev of events) byLead.set(ev.prospectId, ev);
  const list = [...byLead.values()].slice(0, MAX_PER_PASS);
  return mapWithConcurrency(list, 3, (ev) =>
    draftOne(admin, mailbox, ev, writer, signature).catch(
      (): ReplyDraftOutcome => ({ event: ev, company: null, intent: null, dmId: null, draft: null })
    )
  );
}
