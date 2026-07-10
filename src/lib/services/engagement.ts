import type {
  EngagementItem,
  EngagementPlatform,
  EngagementSentiment,
  EngagementSummary,
  EngagementType,
} from "@/lib/types/engagement";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateEngagementReplyDraft,
  type ReplyDraft,
} from "@/lib/ai/engagement-reply";

export async function getEngagementItems(tenantSlug: string): Promise<EngagementItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("engagement_items")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("received_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    tenantSlug: row.tenant_slug,
    type: row.type as EngagementType,
    platform: row.platform as EngagementPlatform,
    fromName: row.from_name,
    fromHandle: row.from_handle ?? null,
    fromAvatar: row.from_avatar ?? null,
    content: row.content,
    postTitle: row.post_title ?? null,
    externalUrl: row.external_url ?? null,
    receivedAt: row.received_at,
    read: row.read,
    replied: row.replied,
    sentiment: row.sentiment as EngagementSentiment,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  }));
}

// ── Inbox group (client-injected — REST /api/v1 and MCP tools share these)

export interface InboxItem {
  id: string;
  type: string;
  platform: string;
  fromName: string;
  fromHandle: string | null;
  content: string;
  postTitle: string | null;
  externalUrl: string | null;
  receivedAt: string;
  read: boolean;
  replied: boolean;
  sentiment: string;
  aiDraft: Record<string, unknown> | null;
  approvalStatus: string | null;
}

export async function listInboxItems(
  client: SupabaseClient,
  tenantSlug: string,
  filter: { platform?: string; unansweredOnly?: boolean; limit?: number; offset?: number } = {}
): Promise<{ data: InboxItem[]; total: number }> {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;

  let query = client
    .from("engagement_items")
    .select("*", { count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filter.platform) query = query.eq("platform", filter.platform);
  if (filter.unansweredOnly) query = query.eq("replied", false);

  const { data, error, count } = await query;
  if (error || !data) return { data: [], total: 0 };

  return {
    data: data.map((row) => ({
      id: row.id,
      type: row.type,
      platform: row.platform,
      fromName: row.from_name,
      fromHandle: row.from_handle,
      content: row.content,
      postTitle: row.post_title,
      externalUrl: row.external_url,
      receivedAt: row.received_at,
      read: row.read,
      replied: row.replied,
      sentiment: row.sentiment,
      aiDraft: row.ai_draft,
      approvalStatus: row.approval_status,
    })),
    total: count ?? 0,
  };
}

/** Generates an on-brand reply draft (same generator the in-app approval
 * queue uses) and writes it back the same way draftEngagementReply() does. */
export async function draftAndSaveReply(
  client: SupabaseClient,
  tenantSlug: string,
  tenantName: string,
  itemId: string
): Promise<{ draft: ReplyDraft } | { error: string; status: 404 | 500 }> {
  const { data: item } = await client
    .from("engagement_items")
    .select("id, type, platform, content, from_handle")
    .eq("tenant_slug", tenantSlug)
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { error: "Inbox item not found", status: 404 };

  let draft: ReplyDraft;
  try {
    draft = await generateEngagementReplyDraft({
      tenantSlug,
      tenantName,
      item: {
        type: item.type,
        platform: item.platform,
        content: item.content,
        fromHandle: item.from_handle,
      },
    });
  } catch {
    return { error: "Reply draft generation failed. Please try again.", status: 500 };
  }

  const { error } = await client
    .from("engagement_items")
    .update({ ai_draft: draft, approval_status: "pending_review" })
    .eq("tenant_slug", tenantSlug)
    .eq("id", itemId);
  if (error) return { error: error.message, status: 500 };

  return { draft };
}

/** Mirrors markAsReplied() in actions/engagement.ts, but explicitly
 * tenant-scoped — that action relies on RLS alone, which doesn't apply
 * under admin-client token auth. */
export async function markInboxReplied(
  client: SupabaseClient,
  tenantSlug: string,
  itemId: string
): Promise<{ ok: true } | { ok: false; status: 404 | 500; error?: string }> {
  const { data, error } = await client
    .from("engagement_items")
    .update({ replied: true, read: true })
    .eq("tenant_slug", tenantSlug)
    .eq("id", itemId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404 };
  return { ok: true };
}

export function summarize(items: EngagementItem[]): EngagementSummary {
  return {
    total: items.length,
    unread: items.filter((i) => !i.read).length,
    unreplied: items.filter((i) => !i.replied).length,
    dms: items.filter((i) => i.type === "dm").length,
    mentions: items.filter((i) => i.type === "mention").length,
    comments: items.filter((i) => i.type === "comment").length,
  };
}
