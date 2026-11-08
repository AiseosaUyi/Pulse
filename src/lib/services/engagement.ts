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
import {
  getActiveHandoffsMap,
  parseThreadExternalId,
  type HandoffSummary,
} from "@/lib/services/handoff";

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
  status: string;
  assignedTo: string | null;
  sentBody: string | null;
  proposedReply: string | null;
  proposedReplyAuthor: string | null;
  externalId: string | null;
  threadExternalId?: string | null;
  priority: string;
  dueAt: string | null;
  meta?: Record<string, unknown> | null;
  handoff?: HandoffSummary | null;
  handoffStale?: boolean;
}

export async function listInboxItems(
  client: SupabaseClient,
  tenantSlug: string,
  filter: { platform?: string; unansweredOnly?: boolean; status?: string; limit?: number; offset?: number } = {}
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
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.unansweredOnly) {
    query = query.eq("replied", false).neq("status", "handed_off");
  }

  const { data, error, count } = await query;
  if (error || !data) return { data: [], total: 0 };

  const threads = data
    .map((row) => ({
      platform: row.platform as string,
      threadExternalId: (row.thread_external_id as string | null) ?? parseThreadExternalId(row.external_id as string | null) ?? "",
    }))
    .filter((t) => !!t.platform && !!t.threadExternalId);

  const handoffsMap = await getActiveHandoffsMap(client, tenantSlug, threads);

  return {
    data: data.map((row) => {
      const threadExtId = (row.thread_external_id as string | null) ?? parseThreadExternalId(row.external_id as string | null);
      const handoffInfo = threadExtId ? handoffsMap.get(`${row.platform}:${threadExtId}`) : undefined;

      return {
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
        status: row.status ?? "open",
        assignedTo: row.assigned_to ?? null,
        sentBody: row.sent_body ?? null,
        proposedReply: row.proposed_reply ?? null,
        proposedReplyAuthor: row.proposed_reply_author ?? null,
        externalId: row.external_id ?? null,
        threadExternalId: threadExtId,
        priority: row.priority ?? "normal",
        dueAt: row.due_at ?? null,
        meta: (row.meta as Record<string, unknown> | null) ?? null,
        handoff: handoffInfo?.handoff ?? null,
        handoffStale: handoffInfo?.isStale ?? false,
      };
    }),
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
 * under admin-client token auth. Also keeps the Action Queue status model
 * (migration 105) consistent: resolving a reply here is the same
 * transition as resolving it from the queue's setQueueStatus, so
 * GET /api/v1/inbox?unanswered=true and the queue never disagree about
 * whether this row is still open. */
export async function markInboxReplied(
  client: SupabaseClient,
  tenantSlug: string,
  itemId: string
): Promise<{ ok: true } | { ok: false; status: 404 | 500; error?: string }> {
  const { data, error } = await client
    .from("engagement_items")
    .update({ replied: true, read: true, status: "resolved", resolved_at: new Date().toISOString() })
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

/**
 * Data repair routine (mirrors migration 114):
 * - For rows where resolved_at > received_at and status='open', nulls resolved_at.
 * - Where received_at > resolved_at and status='open' (or replied=true), sets replied=false and resolved_at=null.
 * Logs each row repaired.
 */
export async function repairInconsistentEngagementRows(
  client: SupabaseClient,
  tenantSlug?: string
): Promise<{ repaired: { id: string; action: string; prev: Record<string, unknown> }[] }> {
  let query = client
    .from("engagement_items")
    .select("id, tenant_slug, external_id, received_at, resolved_at, replied, status")
    .eq("status", "open");

  if (tenantSlug) {
    query = query.eq("tenant_slug", tenantSlug);
  }

  const { data: rows, error } = await query;
  if (error || !rows) return { repaired: [] };

  const repaired: { id: string; action: string; prev: Record<string, unknown> }[] = [];

  for (const row of rows) {
    const receivedTime = row.received_at ? new Date(row.received_at).getTime() : 0;
    const resolvedTime = row.resolved_at ? new Date(row.resolved_at).getTime() : null;

    if (resolvedTime !== null && resolvedTime > receivedTime) {
      console.log(
        `[repairInconsistentEngagementRows] resolved_at > received_at: id=${row.id}, tenant=${row.tenant_slug}, resolved_at=${row.resolved_at}, received_at=${row.received_at}`
      );
      await client
        .from("engagement_items")
        .update({ resolved_at: null })
        .eq("id", row.id);
      repaired.push({ id: row.id, action: "nulled_resolved_at", prev: { resolved_at: row.resolved_at } });
    } else if (resolvedTime !== null && receivedTime > resolvedTime) {
      console.log(
        `[repairInconsistentEngagementRows] received_at > resolved_at: id=${row.id}, tenant=${row.tenant_slug}, received_at=${row.received_at}, resolved_at=${row.resolved_at}`
      );
      await client
        .from("engagement_items")
        .update({ replied: false, resolved_at: null })
        .eq("id", row.id);
      repaired.push({ id: row.id, action: "cleared_replied_and_resolved_at", prev: { replied: row.replied, resolved_at: row.resolved_at } });
    } else if (row.replied === true) {
      console.log(
        `[repairInconsistentEngagementRows] open with replied=true: id=${row.id}, tenant=${row.tenant_slug}`
      );
      await client
        .from("engagement_items")
        .update({ replied: false, resolved_at: null })
        .eq("id", row.id);
      repaired.push({ id: row.id, action: "cleared_replied_and_resolved_at", prev: { replied: row.replied } });
    }
  }

  return { repaired };
}
