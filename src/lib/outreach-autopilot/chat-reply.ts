// WhatsApp / Instagram chats a person brings into Pulse (an exported chat
// file or pasted messages), and the reply Pulse drafts for them.
//
// Pulse never reads or sends on WhatsApp or Instagram itself. A teammate
// exports or pastes a chat; this stores the lead's messages, and when the
// lead spoke last, drafts an answer as a chat draft (outbound_dms channel
// 'whatsapp' | 'instagram', kind 'reply'). After approval the teammate sends
// it from their own phone and taps "I sent it" (review.ts markSentByHand).
//
//   - The lead is found by phone (WhatsApp) or handle (Instagram) inside the
//     caller's tenant only, or passed explicitly and checked to be in it.
//   - Messages are deduplicated by a hash of channel + contact + time + text,
//     so uploading the same export twice stores nothing new.
//   - One open chat draft per lead per channel: a newer chat rewrites it and
//     pulls an approval of the old text back to draft.
//   - Closed or dismissed leads get no draft.
//
// The writer (the AI call) is passed in, so this file has no model imports.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findProspectForInbound, phoneKey, handleKey } from "@/lib/outbound/match-prospect";
import { normalizePhone } from "@/lib/services/outreach-ledger";
import { cancelPendingFollowUps, markProspectReplied } from "@/lib/services/prospect-inbound-link";
import { finishReplyBody, replyNotes, type ReplyIntent, type ReplyWriter } from "./reply-copy";

export type ChatChannel = "whatsapp" | "instagram";

export interface ChatMessage {
  /** "them" = the lead, "us" = anyone on our side. */
  from: "them" | "us";
  text: string;
  /** ISO time the message was sent. */
  at: string;
}

export interface ChatImportInput {
  channel: ChatChannel;
  /** The lead's phone (whatsapp) or handle (instagram), as typed or in the export. */
  contact: string;
  messages: ChatMessage[];
  /** Pick the lead directly instead of matching by contact. Must be in the tenant. */
  prospectId?: string | null;
}

export type ChatImportResult =
  | { ok: false; error: string }
  | {
      ok: true;
      prospectId: string;
      company: string | null;
      stored: number;
      /** Why no draft was made, when none was. */
      noDraftReason: string | null;
      dmId: string | null;
      draft: string | null;
      intent: ReplyIntent | null;
    };

const NO_ANSWER_STATUSES = new Set(["closed_lost", "dismissed", "unqualified"]);
const MAX_MESSAGES = 400;
const MAX_TEXT = 3000;

/** The address a chat draft is sent to: E.164 phone or bare handle, or "" if unusable. */
export function chatContact(channel: ChatChannel, raw: string): string {
  if (channel === "whatsapp") return phoneKey(raw) ? normalizePhone(raw) : "";
  return handleKey(raw);
}

/** Stable id for one message so a re-upload is a no-op. */
export function chatMessageId(channel: ChatChannel, contact: string, m: ChatMessage): string {
  const h = createHash("sha256").update(`${channel}|${contact}|${m.at}|${m.text.trim()}`).digest("hex");
  return `import:${h.slice(0, 40)}`;
}

function cleanMessages(list: ChatMessage[]): ChatMessage[] {
  return list
    .filter((m) => (m.from === "them" || m.from === "us") && typeof m.text === "string" && m.text.trim())
    .filter((m) => !Number.isNaN(Date.parse(m.at)))
    .map((m) => ({ from: m.from, text: m.text.trim().slice(0, MAX_TEXT), at: new Date(m.at).toISOString() }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MAX_MESSAGES);
}

export async function importChatAndDraft(
  admin: SupabaseClient,
  tenantSlug: string,
  input: ChatImportInput,
  deps: {
    writer: ReplyWriter | null;
    senderName: string;
    /** Only leads this teammate owns (members). Omit for owners/admins. */
    ownerPersonId?: string;
  }
): Promise<ChatImportResult> {
  const contact = chatContact(input.channel, input.contact);
  if (!contact) {
    return { ok: false, error: input.channel === "whatsapp" ? "Add the lead's phone number" : "Add the lead's Instagram handle" };
  }
  const messages = cleanMessages(input.messages);
  if (!messages.length) return { ok: false, error: "No messages found" };

  // 1. Which lead.
  let prospectId: string | null = null;
  if (input.prospectId) {
    const { data } = await admin
      .from("prospects")
      .select("id")
      .eq("tenant_slug", tenantSlug)
      .eq("id", input.prospectId)
      .maybeSingle();
    prospectId = (data?.id as string) ?? null;
  } else {
    prospectId = await findProspectForInbound(admin, tenantSlug, {
      channel: input.channel,
      phone: input.channel === "whatsapp" ? contact : null,
      handle: input.channel === "instagram" ? contact : null,
    });
  }
  if (!prospectId) {
    return {
      ok: false,
      error:
        input.channel === "whatsapp"
          ? "No lead has this phone number. Add it to the lead, or pick the lead."
          : "No Instagram lead has this handle. Pick the lead.",
    };
  }

  const { data: p } = await admin
    .from("prospects")
    .select("id, status, owner_person_id, verified_name, display_name, company_name, handle")
    .eq("tenant_slug", tenantSlug)
    .eq("id", prospectId)
    .maybeSingle();
  if (!p) return { ok: false, error: "Lead not found" };
  if (deps.ownerPersonId && p.owner_person_id !== deps.ownerPersonId) {
    return { ok: false, error: "This lead belongs to someone else" };
  }
  const company = ((p.company_name as string) || (p.display_name as string) || (p.handle as string) || "").trim() || null;

  // 2. Store the lead's messages (ours stay in the export; the draft uses them as context).
  const theirs = messages.filter((m) => m.from === "them");
  let stored = 0;
  if (theirs.length) {
    const rows = theirs.map((m) => ({
      tenant_slug: tenantSlug,
      prospect_id: prospectId,
      platform: input.channel,
      channel: input.channel,
      external_id: chatMessageId(input.channel, contact, m),
      body: m.text,
      from_handle: contact,
      received_at: m.at,
    }));
    const { data: existing } = await admin
      .from("inbound_messages")
      .select("external_id")
      .eq("tenant_slug", tenantSlug)
      .eq("platform", input.channel)
      .in("external_id", rows.map((r) => r.external_id));
    const have = new Set((existing ?? []).map((r) => r.external_id as string));
    const fresh = rows.filter((r) => !have.has(r.external_id));
    if (fresh.length) {
      const { error } = await admin.from("inbound_messages").insert(fresh);
      if (error) return { ok: false, error: "Could not save the messages" };
      stored = fresh.length;
      await markProspectReplied(admin, tenantSlug, prospectId);
      await cancelPendingFollowUps(admin, tenantSlug, prospectId);
    }
  }

  const base = { ok: true as const, prospectId, company, stored, dmId: null, draft: null, intent: null };

  // 3. Draft an answer only when they spoke last.
  const last = messages[messages.length - 1];
  if (last.from !== "them") return { ...base, noDraftReason: "You replied last, so there is nothing to answer" };
  if (NO_ANSWER_STATUSES.has(p.status as string)) return { ...base, noDraftReason: "This lead is closed" };
  if (!deps.writer) return { ...base, noDraftReason: "AI drafting is off or out of budget" };

  const thread = messages.slice(-12).map((m) => ({
    direction: m.from === "them" ? ("inbound" as const) : ("outbound" as const),
    body: m.text,
  }));
  const result = await deps
    .writer({
      tenantSlug,
      senderName: deps.senderName,
      signature: "",
      prospectName: ((p.verified_name as string) || "").trim(),
      company: company ?? "",
      thread,
      latest: last.text,
      channel: input.channel,
    })
    .catch(() => null);
  if (!result) return { ...base, noDraftReason: "Could not write a draft right now" };
  if (!result.body) return { ...base, intent: result.intent, noDraftReason: "No answer needed" };

  const body = finishReplyBody(result.body, "");
  const notes = replyNotes(result, last.text);

  // 4. One open draft per lead per channel.
  const { data: open } = await admin
    .from("outbound_dms")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", prospectId)
    .eq("channel", input.channel)
    .eq("kind", "reply")
    .in("status", ["drafted", "approved"])
    .maybeSingle();

  if (open) {
    const { data } = await admin
      .from("outbound_dms")
      .update({
        body,
        lint_warnings: notes,
        to_contact: contact,
        status: "drafted",
        send_via: null,
        approved_at: null,
        approved_via: null,
        approved_by: null,
        scheduled_send_at: null,
      })
      .eq("tenant_slug", tenantSlug)
      .eq("id", open.id)
      .in("status", ["drafted", "approved"])
      .select("id")
      .maybeSingle();
    if (!data) return { ...base, intent: result.intent, noDraftReason: "The open draft changed, try again" };
    return { ...base, intent: result.intent, noDraftReason: null, dmId: open.id as string, draft: body };
  }

  const { data: lastVersion } = await admin
    .from("outbound_dms")
    .select("version")
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", prospectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: row, error } = await admin
    .from("outbound_dms")
    .insert({
      tenant_slug: tenantSlug,
      prospect_id: prospectId,
      version: ((lastVersion?.version as number) ?? 0) + 1,
      kind: "reply",
      channel: input.channel,
      to_contact: contact,
      body,
      lint_warnings: notes,
      status: "drafted",
      generator_model: "autopilot-chat-reply",
      generator_cost_usd: 0,
    })
    .select("id")
    .single();
  if (error || !row) return { ...base, intent: result.intent, noDraftReason: "Could not save the draft" };
  return { ...base, intent: result.intent, noDraftReason: null, dmId: row.id as string, draft: body };
}
