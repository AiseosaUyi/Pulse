"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";
import { resolveActiveConnection } from "@/lib/composio/resolve-alias";
import {
  replyToInstagramComment,
  sendInstagramDM,
  commentOnLinkedInPost,
} from "@/lib/composio/executors";
import { getTenant } from "@/lib/services/tenants";
import { generateEngagementReplyDraft } from "@/lib/ai/engagement-reply";
import type { Toolkit } from "@/lib/composio/client";

const TYPES = ["dm", "comment", "mention", "reply"] as const;
const PLATFORMS = ["instagram", "tiktok", "twitter", "linkedin"] as const;
const SENTIMENTS = ["positive", "neutral", "negative", "question"] as const;

function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createEngagementItem(formData: FormData) {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const type = formData.get("type");
  const platform = formData.get("platform");
  const sentiment = formData.get("sentiment") ?? "neutral";
  const fromName = str(formData, "fromName");
  const fromHandle = str(formData, "fromHandle") || null;
  const fromAvatar = str(formData, "fromAvatar") || null;
  const content = str(formData, "content");
  const postTitle = str(formData, "postTitle") || null;
  const externalUrl = str(formData, "externalUrl") || null;

  if (!isOneOf(TYPES, type)) return { success: false, error: "Select a type" };
  if (!isOneOf(PLATFORMS, platform)) return { success: false, error: "Select a platform" };
  if (!isOneOf(SENTIMENTS, sentiment)) return { success: false, error: "Invalid sentiment" };
  if (!fromName) return { success: false, error: "Sender name is required" };
  if (!content) return { success: false, error: "Message content is required" };

  const supabase = await createClient();
  const { error } = await supabase.from("engagement_items").insert({
    tenant_slug: tenant.slug,
    type,
    platform,
    from_name: fromName,
    from_handle: fromHandle,
    from_avatar: fromAvatar,
    content,
    post_title: postTitle,
    external_url: externalUrl,
    sentiment,
    created_by: user.id,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/engagement");
  return { success: true };
}

export async function markAsRead(itemId: string, read: boolean) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("engagement_items")
    .update({ read })
    .eq("id", itemId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/engagement");
  return { success: true };
}

export async function markAsReplied(itemId: string, replied: boolean) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("engagement_items")
    .update({ replied, read: true })
    .eq("id", itemId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/engagement");
  return { success: true };
}

// Sends a real reply to an engagement item via Composio. Routes by
// (platform, type): IG comments → POST_IG_COMMENT_REPLIES, IG DMs →
// SEND_TEXT_MESSAGE, LinkedIn comments → CREATE_COMMENT_ON_POST.
// On success, marks the row replied + read so the inbox UI reflects it.
export async function sendEngagementReply(
  itemId: string,
  message: string
): Promise<
  | { success: true }
  | { success: false; error: string; reason?: "not_connected" | "unsupported" }
> {
  await requireUser();
  const supabase = await createClient();

  if (!message.trim()) {
    return { success: false, error: "Message cannot be empty" };
  }

  const { data: item, error: readErr } = await supabase
    .from("engagement_items")
    .select("id, tenant_slug, platform, type, external_id, meta")
    .eq("id", itemId)
    .single();

  if (readErr || !item) {
    return { success: false, error: readErr?.message ?? "Item not found" };
  }

  const platform = (item.platform as string).toLowerCase() as Toolkit;
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
      // linkedin — only comments are supported
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

  await supabase
    .from("engagement_items")
    .update({ replied: true, read: true })
    .eq("id", itemId);

  revalidatePath("/engagement");
  return { success: true };
}

export async function deleteEngagementItem(itemId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("engagement_items")
    .delete()
    .eq("id", itemId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/engagement");
  return { success: true };
}

// ── Reply approval queue ──────────────────────────────────────────────────
// Generate an AI reply draft for an inbound item and park it as
// pending_review. Nothing sends until a human approves.
export async function draftEngagementReply(itemId: string) {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from("engagement_items")
    .select("id, type, platform, content, from_handle")
    .eq("id", itemId)
    .single();
  if (error || !item) {
    return { success: false, error: error?.message ?? "Item not found" };
  }

  const t = await getTenant(tenant.slug);
  try {
    const draft = await generateEngagementReplyDraft({
      tenantSlug: tenant.slug,
      tenantName: t?.name ?? tenant.slug,
      item: {
        type: item.type as string,
        platform: item.platform as string,
        content: item.content as string,
        fromHandle: (item.from_handle as string) ?? null,
      },
    });
    await supabase
      .from("engagement_items")
      .update({ ai_draft: draft, approval_status: "pending_review" })
      .eq("id", itemId);
    revalidatePath("/engagement");
    return { success: true, draft };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Draft failed",
    };
  }
}

// Approve (optionally edited) and send via the existing reply path, then mark
// the item sent + record who approved it.
export async function approveEngagementReply(itemId: string, editedBody?: string) {
  const user = await requireUser();
  const supabase = await createClient();

  let body = (editedBody ?? "").trim();
  if (!body) {
    const { data: item } = await supabase
      .from("engagement_items")
      .select("ai_draft")
      .eq("id", itemId)
      .single();
    body = ((item?.ai_draft as { body?: string } | null)?.body ?? "").trim();
  }
  if (!body) return { success: false, error: "No draft to send" };

  const sent = await sendEngagementReply(itemId, body);
  if (!sent.success) return sent;

  await supabase
    .from("engagement_items")
    .update({
      approval_status: "sent",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  revalidatePath("/engagement");
  return { success: true };
}

export async function rejectEngagementDraft(itemId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("engagement_items")
    .update({ approval_status: "rejected" })
    .eq("id", itemId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/engagement");
  return { success: true };
}
