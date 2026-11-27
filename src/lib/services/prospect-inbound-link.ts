// Links an inbound message that arrived on a connected channel (WhatsApp
// Cloud API webhook, Composio Instagram DM sync) to the prospect who sent
// it, so the reply flows into Outbound like any other prospect reply.
//
// Receive-side only: nothing here sends anything to anyone.
//
// What "linked" means (mirrors recordInboundMessage + the email autopilot):
//   - the inbound_messages row carries prospect_id (the SAME row when one
//     already exists, e.g. the WhatsApp row the webhook just stored, so the
//     message is never duplicated and stays visible in Conversations)
//   - the prospect moves to "replied" unless a human already moved it past
//     that point (handed off, closed, dismissed, unqualified) or the thread
//     is handed off to another channel
//   - pending email follow-ups are cancelled ("They replied")
//   - the conversation is auto-analysed (same as recordInboundMessage)
//
// Idempotent: a row that already has a prospect_id is left alone, so a
// webhook retry or the 24h re-scan window of the Composio sync never
// re-runs the side effects.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findProspectForInbound,
  type InboundChannel,
} from "@/lib/outbound/match-prospect";

/** Statuses a reply may move to "replied". Anything else was set by a
 * human (or is already further along) and is never overwritten. */
const REPLYABLE_STATUSES = new Set([
  "new",
  "qualifying",
  "qualified",
  "drafted",
  "approved",
  "sent",
]);

export interface InboundToLink {
  tenantSlug: string;
  channel: InboundChannel;
  /** inbound_messages.platform for this message (e.g. "whatsapp", "instagram"). */
  platform: string;
  /** Provider message id (inbound_messages.external_id). */
  externalId: string;
  body: string;
  receivedAt: string;
  /** Raw sender phone (WhatsApp). */
  phone?: string | null;
  /** Raw sender handle (Instagram / TikTok). */
  handle?: string | null;
}

export type LinkResult =
  | { linked: false; reason: "no_match" | "already_linked" | "error" }
  | { linked: true; prospectId: string; inboundMessageId: string; statusChanged: boolean };

export async function linkInboundToProspect(
  client: SupabaseClient,
  input: InboundToLink
): Promise<LinkResult> {
  const prospectId = await findProspectForInbound(client, input.tenantSlug, {
    channel: input.channel,
    phone: input.phone,
    handle: input.handle,
  });
  if (!prospectId) return { linked: false, reason: "no_match" };

  try {
    const { data: existing } = await client
      .from("inbound_messages")
      .select("id, prospect_id")
      .eq("tenant_slug", input.tenantSlug)
      .eq("platform", input.platform)
      .eq("external_id", input.externalId)
      .maybeSingle();

    let inboundMessageId: string;
    if (existing) {
      if (existing.prospect_id) return { linked: false, reason: "already_linked" };
      // Claim the row only while it is still unlinked, so two concurrent
      // deliveries of the same message cannot both run the side effects.
      const { data: claimed, error } = await client
        .from("inbound_messages")
        .update({ prospect_id: prospectId })
        .eq("tenant_slug", input.tenantSlug)
        .eq("id", existing.id)
        .is("prospect_id", null)
        .select("id");
      if (error) return { linked: false, reason: "error" };
      if (!claimed || (claimed as unknown[]).length === 0) {
        return { linked: false, reason: "already_linked" };
      }
      inboundMessageId = existing.id as string;
    } else {
      const { data: inserted, error } = await client
        .from("inbound_messages")
        .insert({
          tenant_slug: input.tenantSlug,
          prospect_id: prospectId,
          platform: input.platform,
          channel: input.channel,
          external_id: input.externalId,
          body: input.body || "(empty message)",
          from_handle: input.handle ?? input.phone ?? null,
          received_at: input.receivedAt,
        })
        .select("id")
        .single();
      // A unique-violation here means another run stored it first.
      if (error || !inserted) return { linked: false, reason: "error" };
      inboundMessageId = inserted.id as string;
    }

    const statusChanged = await markProspectReplied(client, input.tenantSlug, prospectId);
    await cancelPendingFollowUps(client, input.tenantSlug, prospectId);

    // Same auto-analysis recordInboundMessage runs. Never throws.
    const { analyzeConversationSystem } = await import(
      "@/lib/services/outreach-intelligence"
    );
    await analyzeConversationSystem(client, input.tenantSlug, prospectId, inboundMessageId);

    return { linked: true, prospectId, inboundMessageId, statusChanged };
  } catch {
    return { linked: false, reason: "error" };
  }
}

/** Moves the prospect to "replied" when that is a forward move and the
 * thread is not handed off. Always refreshes last_touched_at. Returns
 * whether the status changed. */
async function markProspectReplied(
  client: SupabaseClient,
  tenantSlug: string,
  prospectId: string
): Promise<boolean> {
  const { data: p } = await client
    .from("prospects")
    .select("id, status, channel_handoff")
    .eq("tenant_slug", tenantSlug)
    .eq("id", prospectId)
    .maybeSingle();
  if (!p) return false;

  const handedOff = Boolean(p.channel_handoff) && p.channel_handoff !== "none";
  const canMove = !handedOff && REPLYABLE_STATUSES.has(String(p.status));
  const now = new Date().toISOString();

  await client
    .from("prospects")
    .update(canMove ? { status: "replied", last_touched_at: now } : { last_touched_at: now })
    .eq("tenant_slug", tenantSlug)
    .eq("id", prospectId);
  return canMove;
}

/** Same rule as the email autopilot: once they reply, queued follow-ups stop. */
async function cancelPendingFollowUps(
  client: SupabaseClient,
  tenantSlug: string,
  prospectId: string
): Promise<void> {
  await client
    .from("outbound_dms")
    .update({ status: "cancelled", error: "They replied" })
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", prospectId)
    .in("kind", ["follow_up_1", "follow_up_2"])
    .in("status", ["drafted", "approved"]);
}
