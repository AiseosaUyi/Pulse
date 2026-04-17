import type {
  EngagementItem,
  EngagementPlatform,
  EngagementSentiment,
  EngagementSummary,
  EngagementType,
} from "@/lib/types/engagement";
import { createClient } from "@/lib/supabase/server";

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
