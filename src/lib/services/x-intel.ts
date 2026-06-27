import { createClient } from "@/lib/supabase/server";
import type { XSignalCard, XIntelConfig } from "@/lib/types/x-intel";

export async function getXSignalCards(tenantSlug: string): Promise<XSignalCard[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("x_signal_cards")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .is("dismissed_at", null)
    .order("likes", { ascending: false })
    .order("detected_at", { ascending: false })
    .limit(60);

  if (!data) return [];

  return data.map((row) => ({
    id: row.id,
    tenantSlug: row.tenant_slug,
    signalType: row.signal_type,
    matchedKeyword: row.matched_keyword ?? null,
    accountHandle: row.account_handle ?? null,
    tweetId: row.tweet_id,
    authorHandle: row.author_handle,
    authorName: row.author_name ?? null,
    authorFollowers: row.author_followers ?? null,
    tweetText: row.tweet_text,
    tweetUrl: row.tweet_url,
    likes: row.likes,
    reposts: row.reposts,
    replies: row.replies,
    postedAt: row.posted_at,
    detectedAt: row.detected_at,
    aiReply: row.ai_reply ?? null,
    aiQuoteTweet: row.ai_quote_tweet ?? null,
    aiAction: (row.ai_action as XSignalCard["aiAction"]) ?? null,
    aiScore: row.ai_score ?? null,
    aiReasoning: row.ai_reasoning ?? null,
  }));
}

export async function getXIntelConfig(tenantSlug: string): Promise<XIntelConfig> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .single();

  const settings = (data?.settings as Record<string, unknown> | null) ?? {};
  const raw = settings.x_intel_config as Partial<XIntelConfig> | undefined;

  return {
    keywords: raw?.keywords ?? [],
    accounts: raw?.accounts ?? [],
    min_engagement: raw?.min_engagement ?? 15,
    enabled: raw?.enabled ?? false,
  };
}
