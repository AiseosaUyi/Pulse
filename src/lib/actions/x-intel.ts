"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import type { XIntelConfig } from "@/lib/types/x-intel";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import {
  generateEngagementSuggestion,
  generatePostIdeas,
  type XEngagementSuggestion,
  type XPostIdea,
} from "@/lib/ai/x-engage";

type ActionResult = { success: true } | { success: false; error: string };

export async function saveXIntelConfig(
  tenantSlug: string,
  config: XIntelConfig
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const keywords = config.keywords
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);

  const accounts = config.accounts
    .map((a) => a.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean)
    .slice(0, 30);

  const admin = createAdminClient();
  const { error } = await admin.rpc("jsonb_set_setting", {
    p_tenant_slug: tenantSlug,
    p_key: "x_intel_config",
    p_value: JSON.stringify({
      keywords,
      accounts,
      min_engagement: Math.max(0, Math.min(500, config.min_engagement ?? 15)),
      enabled: config.enabled,
    }),
  });

  if (error) {
    // Fall back to a direct update if the RPC isn't available.
    const supabase = await createClient();
    const { data: tenant } = await supabase
      .from("tenants")
      .select("settings")
      .eq("slug", tenantSlug)
      .single();

    const settings = (tenant?.settings as Record<string, unknown> | null) ?? {};
    const { error: updateError } = await admin
      .from("tenants")
      .update({
        settings: {
          ...settings,
          x_intel_config: {
            keywords,
            accounts,
            min_engagement: Math.max(0, Math.min(500, config.min_engagement ?? 15)),
            enabled: config.enabled,
          },
        },
      })
      .eq("slug", tenantSlug);

    if (updateError) return { success: false, error: updateError.message };
  }

  return { success: true };
}

export async function dismissXSignal(signalId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("x_signal_cards")
    .update({ dismissed_at: new Date().toISOString(), dismissed_by: user.id })
    .eq("id", signalId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function suggestXEngagement(
  signalId: string,
  tenantSlug: string
): Promise<
  | { success: true; data: XEngagementSuggestion; cached: boolean }
  | { success: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { data: card } = await supabase
    .from("x_signal_cards")
    .select(
      "tweet_text,author_handle,author_followers,likes,signal_type,matched_keyword,ai_reply,ai_quote_tweet,ai_action,ai_score,ai_reasoning,ai_generated_at"
    )
    .eq("id", signalId)
    .single();

  if (!card) return { success: false, error: "Signal not found" };

  // Return cached result if available — no API call needed
  if (card.ai_generated_at && card.ai_reply && card.ai_quote_tweet && card.ai_action) {
    return {
      success: true,
      cached: true,
      data: {
        reply: card.ai_reply,
        quoteTweet: card.ai_quote_tweet,
        action: card.ai_action as XEngagementSuggestion["action"],
        reasoning: card.ai_reasoning ?? "",
        opportunityScore: card.ai_score ?? 5,
      },
    };
  }

  const { voice, positioning } = await getBrandContext(tenantSlug);

  try {
    const data = await generateEngagementSuggestion({
      tenantSlug,
      tweetText: card.tweet_text,
      authorHandle: card.author_handle,
      authorFollowers: card.author_followers,
      likes: card.likes,
      signalType: card.signal_type,
      matchedKeyword: card.matched_keyword,
      voice,
      positioning,
    });

    // Persist to DB so future calls are free (admin client bypasses RLS for writes)
    const admin = createAdminClient();
    await admin
      .from("x_signal_cards")
      .update({
        ai_reply: data.reply,
        ai_quote_tweet: data.quoteTweet,
        ai_action: data.action,
        ai_score: data.opportunityScore,
        ai_reasoning: data.reasoning,
        ai_generated_at: new Date().toISOString(),
      })
      .eq("id", signalId);

    return { success: true, cached: false, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "AI generation failed",
    };
  }
}

const POST_IDEAS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function suggestXPostIdeas(
  tenantSlug: string,
  topSignalIds: string[]
): Promise<
  | { success: true; ideas: XPostIdea[]; cached: boolean }
  | { success: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();

  // Check cache table first
  const { data: cached } = await supabase
    .from("x_post_ideas_cache")
    .select("ideas,generated_at")
    .eq("tenant_slug", tenantSlug)
    .single();

  if (
    cached?.ideas &&
    Array.isArray(cached.ideas) &&
    cached.ideas.length > 0 &&
    Date.now() - new Date(cached.generated_at).getTime() < POST_IDEAS_TTL_MS
  ) {
    return { success: true, cached: true, ideas: cached.ideas as XPostIdea[] };
  }

  const { data: cards } = await supabase
    .from("x_signal_cards")
    .select("author_handle,tweet_text,likes,signal_type")
    .in("id", topSignalIds)
    .is("dismissed_at", null)
    .order("likes", { ascending: false })
    .limit(8);

  if (!cards?.length) return { success: false, error: "No signals found" };

  const { voice, positioning } = await getBrandContext(tenantSlug);

  try {
    const ideas = await generatePostIdeas({
      tenantSlug,
      topPosts: cards.map((c) => ({
        handle: c.author_handle,
        text: c.tweet_text,
        likes: c.likes,
        signalType: c.signal_type,
      })),
      voice,
      positioning,
    });

    // Upsert cache (admin client for write)
    const admin = createAdminClient();
    await admin.from("x_post_ideas_cache").upsert({
      tenant_slug: tenantSlug,
      ideas,
      signal_ids: topSignalIds,
      generated_at: new Date().toISOString(),
    });

    return { success: true, cached: false, ideas };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "AI generation failed",
    };
  }
}
