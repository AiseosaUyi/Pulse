// Dispatch-only reply senders — no auth, no DB writes for the sent state.
// Callers own auth and own persisting `sent_body`/`approval_status`/etc.
// This is what lets the same dispatch core serve both the human server
// action (lib/actions/engagement.ts, lib/actions/inbound-messages.ts) and
// the Phase 3 AI-auto-send path later.

import { resolveActiveConnection } from "@/lib/composio/resolve-alias";
import {
  replyToInstagramComment,
  sendInstagramDM,
  commentOnLinkedInPost,
} from "@/lib/composio/executors";
import { getWhatsappAccount, sendWhatsappText } from "@/lib/integrations/whatsapp";
import type { Toolkit } from "@/lib/composio/client";

export type DispatchResult =
  | { success: true }
  | {
      success: false;
      error: string;
      reason?: "not_connected" | "unsupported" | "no_account" | "send_failed";
    };

// Extracted verbatim (logic-for-logic) from the pre-Phase-2 sendEngagementReply.
export async function dispatchEngagementItemReply(
  item: {
    tenant_slug: string;
    platform: string;
    type: string;
    external_id: string | null;
    meta: unknown;
  },
  message: string
): Promise<DispatchResult> {
  const platform = item.platform.toLowerCase() as Toolkit;
  if (!["instagram", "linkedin"].includes(platform)) {
    return {
      success: false,
      error: `Replying via ${platform} is not supported`,
      reason: "unsupported",
    };
  }

  const conn = await resolveActiveConnection(item.tenant_slug, platform);
  if (!conn) {
    return {
      success: false,
      error: `No active ${platform} connection for this workspace`,
      reason: "not_connected",
    };
  }

  if (!item.external_id) {
    return {
      success: false,
      error: "This item is missing an external_id — cannot route reply",
    };
  }

  try {
    if (platform === "instagram") {
      if (item.type === "comment" || item.type === "mention") {
        await replyToInstagramComment(conn, item.external_id, message);
      } else if (item.type === "dm") {
        const meta = (item.meta ?? {}) as { sender_id?: string };
        if (!meta.sender_id) {
          return { success: false, error: "DM has no sender_id in meta" };
        }
        await sendInstagramDM(conn, meta.sender_id, message);
      } else {
        return {
          success: false,
          error: `Cannot reply to ${item.type} on Instagram`,
          reason: "unsupported",
        };
      }
    } else {
      // linkedin — only comments/replies are supported
      if (item.type !== "comment" && item.type !== "reply") {
        return {
          success: false,
          error: `Cannot reply to ${item.type} on LinkedIn`,
          reason: "unsupported",
        };
      }
      await commentOnLinkedInPost(conn, item.external_id, message);
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Reply failed",
    };
  }

  return { success: true };
}

// New — WhatsApp send via the tenant's connected number.
export async function dispatchInboundMessageReply(
  tenantSlug: string,
  toPhone: string,
  message: string
): Promise<DispatchResult> {
  const account = await getWhatsappAccount(tenantSlug);
  if (!account) {
    return {
      success: false,
      error: "No WhatsApp number connected for this workspace",
      reason: "no_account",
    };
  }

  const result = await sendWhatsappText(account, toPhone, message);
  if (!result.ok) {
    return { success: false, error: result.error, reason: "send_failed" };
  }

  return { success: true };
}
