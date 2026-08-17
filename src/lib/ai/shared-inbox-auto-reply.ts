// AI-covers-when-away: the Track A Phase 3 auto-reply agent. System-actor
// code — uses the ADMIN client directly (never requireUser()/session RLS,
// per CLAUDE.md's service-role-vs-RLS rule: is_tenant_member()-gated RPCs
// resolve auth.uid() to null for a service-role/webhook/cron caller and
// would reject it). Called from the WhatsApp webhook (near-real-time) and
// the composio-sync-engagement cron (Instagram/LinkedIn, once-daily today).
//
// Merged-but-inert by default: settings.sharedInbox.enabled defaults to
// false per tenant (see lib/shared-inbox/types.ts), and
// AI_AUTO_REPLY_KILL_SWITCH force-disables sending everywhere regardless of
// any tenant's settings. Nothing in this file flips either on its own.

import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantMeta } from "@/lib/services/tenants";
import { getSharedInboxConfig } from "@/lib/services/shared-inbox";
import { shouldAiCover } from "@/lib/shared-inbox/office-hours";
import { isAiAutoReplyKillSwitchActive } from "@/lib/shared-inbox/types";
import { generateEngagementReplyDraft } from "@/lib/ai/engagement-reply";
import {
  dispatchEngagementItemReply,
  dispatchInboundMessageReply,
} from "@/lib/services/reply-dispatch";

export interface AutoReplyItem {
  /** Which table this row lives in — whatsapp -> inbound_messages, everything else -> engagement_items (same split as lib/services/conversations.ts's sourceForPlatform). */
  source: "whatsapp" | "engagement";
  /** The row's id in that table. */
  id: string;
  tenantSlug: string;
  platform: string;
  /** engagement_items.type ("comment"|"dm"|"mention"|"reply"); a stable label for WhatsApp messages. */
  type: string;
  content: string;
  fromHandle: string | null;
  /** engagement_items.external_id — required for dispatchEngagementItemReply's routing; unused for whatsapp. */
  externalId: string | null;
  /** engagement_items.meta — required for Instagram DM replies (sender_id); unused for whatsapp. */
  meta: unknown;
  /** The message's own received time — the gate is evaluated against this, not wall-clock at call time. */
  receivedAt: string;
}

export type MaybeAutoReplyOutcome =
  | "kill_switch"
  | "not_covering"
  | "no_recipient"
  | "draft_failed"
  | "drafted_below_threshold"
  | "send_failed"
  | "sent";

export interface MaybeAutoReplyResult {
  outcome: MaybeAutoReplyOutcome;
  drafted: boolean;
  sent: boolean;
  error?: string;
}

/**
 * Draft (and, above the tenant's confidence threshold, auto-send) an AI
 * reply for one inbound row. Fail-closed at every gate: any check that
 * doesn't pass leaves the row exactly as it was (kill switch / not
 * covering) or parks it at approval_status='pending_review' for a human
 * (drafted but below threshold, or the send itself failed) — never a
 * silent send, never a partial write on a draft failure.
 */
export async function maybeAutoReply(item: AutoReplyItem): Promise<MaybeAutoReplyResult> {
  if (isAiAutoReplyKillSwitchActive()) {
    return { outcome: "kill_switch", drafted: false, sent: false };
  }

  const admin = createAdminClient();
  const config = await getSharedInboxConfig(admin, item.tenantSlug);
  if (!shouldAiCover(config, item.receivedAt)) {
    return { outcome: "not_covering", drafted: false, sent: false };
  }

  if (item.source === "whatsapp" && !item.fromHandle) {
    // Wired in only after from_handle is populated (see the webhook call
    // site), but guard defensively — there is no number to send to.
    return { outcome: "no_recipient", drafted: false, sent: false };
  }

  const tenant = await getTenantMeta(admin, item.tenantSlug);
  const tenantName = tenant?.name ?? item.tenantSlug;
  const table = item.source === "whatsapp" ? "inbound_messages" : "engagement_items";

  let draft;
  try {
    draft = await generateEngagementReplyDraft({
      tenantSlug: item.tenantSlug,
      tenantName,
      item: {
        type: item.type,
        platform: item.platform,
        content: item.content,
        fromHandle: item.fromHandle,
      },
    });
  } catch {
    // generateEngagementReplyDraft already logs the failure via logAiCall
    // (success:false) in its own catch block. Leave the row completely
    // undrafted here — no partial ai_draft/approval_status write on a
    // forced/real OpenAI failure.
    return { outcome: "draft_failed", drafted: false, sent: false };
  }

  await admin
    .from(table)
    .update({ ai_draft: draft, approval_status: "pending_review" })
    .eq("id", item.id);

  if (draft.confidenceScore < config.autoSendConfidence) {
    return { outcome: "drafted_below_threshold", drafted: true, sent: false };
  }

  const dispatchResult =
    item.source === "whatsapp"
      ? await dispatchInboundMessageReply(item.tenantSlug, item.fromHandle as string, draft.body)
      : await dispatchEngagementItemReply(
          {
            tenant_slug: item.tenantSlug,
            platform: item.platform,
            type: item.type,
            external_id: item.externalId,
            meta: item.meta,
          },
          draft.body
        );

  if (!dispatchResult.success) {
    // Stays pending_review (already written above) for a human to send
    // manually — never retried silently from here.
    return {
      outcome: "send_failed",
      drafted: true,
      sent: false,
      error: dispatchResult.error,
    };
  }

  await admin
    .from(table)
    .update({
      sent_body: draft.body,
      approval_status: "sent",
      approved_by: null, // AI-authored — approved_by IS NULL is the AI-vs-human signal (see conversations.ts deriveReply()).
      approved_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  return { outcome: "sent", drafted: true, sent: true };
}
