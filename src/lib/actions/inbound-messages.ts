"use server";

// Write path for `inbound_messages` (currently WhatsApp only — see
// src/lib/services/conversations.ts's sourceForPlatform). No action file
// existed for this table before Track A Phase 2.

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";
import { dispatchInboundMessageReply } from "@/lib/services/reply-dispatch";
import {
  engagementItemParticipantKey,
  inboundMessageParticipantKey,
  parseConversationId,
  sourceForPlatform,
} from "@/lib/services/conversations";

const RECENT_WINDOW_DAYS = 90;

function recentCutoffIso(): string {
  return new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Same status-aware time bound as the read path (see conversations.ts) —
// candidate rows for a bulk assign/resolve must never silently exclude
// anything still open, only bound the resolved bucket.
function withStatusAwareBound<T extends { or: (filter: string) => T }>(
  query: T,
  cutoffIso: string
): T {
  return query.or(`status.in.(open,pending),received_at.gt.${cutoffIso}`);
}

async function fetchCandidateIds(
  supabase: SupabaseClient,
  table: "engagement_items" | "inbound_messages",
  tenantSlug: string,
  platform: string,
  participantKey: string
): Promise<string[]> {
  const cutoff = recentCutoffIso();
  // Select "*" rather than a runtime-chosen column string — supabase-js
  // parses select() strings at the type level for row inference, which
  // breaks when the string isn't a literal known at that call site.
  let query = supabase
    .from(table)
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform);
  query = withStatusAwareBound(query, cutoff);
  const { data } = await query;
  if (!data) return [];

  return (data as Record<string, unknown>[])
    .filter((row) => {
      const key =
        table === "engagement_items"
          ? engagementItemParticipantKey({
              meta: row.meta,
              fromHandle: row.from_handle as string | null,
              fromName: row.from_name as string | null,
            })
          : inboundMessageParticipantKey({
              fromHandle: row.from_handle as string | null,
              prospectId: row.prospect_id as string | null,
              id: row.id as string,
            });
      return key === participantKey;
    })
    .map((row) => row.id as string);
}

// Sends a reply to the latest inbound WhatsApp message in a conversation.
// `messageId` should be the conversation's latestRowId (ConversationSummary).
export async function sendInboundMessageReply(
  messageId: string,
  message: string
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await requireUser();
  const supabase = await createClient();

  if (!message.trim()) {
    return { success: false, error: "Message cannot be empty" };
  }

  const { data: row, error } = await supabase
    .from("inbound_messages")
    .select("id, tenant_slug, from_handle, platform")
    .eq("id", messageId)
    .single();

  if (error || !row) {
    return { success: false, error: error?.message ?? "Message not found" };
  }
  if (row.platform !== "whatsapp") {
    return {
      success: false,
      error: `Replying via ${row.platform} isn't supported from this inbox`,
    };
  }
  if (!row.from_handle) {
    return {
      success: false,
      error: "This message has no sender phone number on record",
    };
  }

  const result = await dispatchInboundMessageReply(row.tenant_slug, row.from_handle, message);
  if (!result.success) return result;

  await supabase
    .from("inbound_messages")
    .update({
      sent_body: message,
      approval_status: "sent",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", messageId);

  revalidatePath("/conversations");
  return { success: true };
}

// Bulk assign/unassign every row in a virtual conversation (both source
// tables, filtered by the same participant key — see the plan's grouping
// decision). `assignee` is a user id, `"me"` (resolves to the caller), or
// `null` to unassign.
export async function assignConversation(
  conversationId: string,
  assignee: string | "me" | null
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const parsed = parseConversationId(conversationId);
  if (!parsed) return { success: false, error: "Invalid conversation" };

  const supabase = await createClient();
  const target = assignee === "me" ? user.id : assignee;
  const source = sourceForPlatform(parsed.platform);
  const table = source === "whatsapp" ? "inbound_messages" : "engagement_items";

  const ids = await fetchCandidateIds(
    supabase,
    table,
    tenant.slug,
    parsed.platform,
    parsed.participantKey
  );
  if (ids.length === 0) {
    return { success: false, error: "No messages found for this conversation" };
  }

  const { error } = await supabase.from(table).update({ assigned_to: target }).in("id", ids);
  if (error) return { success: false, error: error.message };

  revalidatePath("/conversations");
  return { success: true };
}

export async function setConversationStatus(
  conversationId: string,
  status: "open" | "resolved"
): Promise<{ success: true } | { success: false; error: string }> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const parsed = parseConversationId(conversationId);
  if (!parsed) return { success: false, error: "Invalid conversation" };

  const supabase = await createClient();
  const source = sourceForPlatform(parsed.platform);
  const table = source === "whatsapp" ? "inbound_messages" : "engagement_items";

  const ids = await fetchCandidateIds(
    supabase,
    table,
    tenant.slug,
    parsed.platform,
    parsed.participantKey
  );
  if (ids.length === 0) {
    return { success: false, error: "No messages found for this conversation" };
  }

  const { error } = await supabase.from(table).update({ status }).in("id", ids);
  if (error) return { success: false, error: error.message };

  revalidatePath("/conversations");
  return { success: true };
}
