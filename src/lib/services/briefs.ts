import type { ContentBrief, ContentBriefStatus } from "@/lib/types/intelligence";
import type { IntelCard } from "@/lib/types/intelligence";
import type { PatternCluster } from "@/lib/ai/group-patterns";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { generateBrief, BriefGenerationError } from "@/lib/ai/generate-brief";
import { getTenantMeta } from "@/lib/services/tenants";

interface BriefRow {
  id: string;
  tenant_id: string;
  triggered_by: string | null;
  triggered_by_type: "intel_card" | "manual";
  platform: string;
  content_type: string;
  title: string;
  outline: string[] | null;
  draft_content: string | null;
  seo_keywords: string[] | null;
  status: ContentBriefStatus;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  generator_model: string | null;
  created_at: string;
  intel_cards?: {
    competitor_name: string;
    platform: string;
  } | null;
}

function rowToBrief(row: BriefRow): ContentBrief {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    triggeredBy: row.triggered_by,
    triggeredByType: row.triggered_by_type,
    platform: row.platform,
    contentType: row.content_type,
    title: row.title,
    outline: row.outline ?? [],
    draftContent: row.draft_content ?? "",
    seoKeywords: row.seo_keywords ?? [],
    status: row.status,
    dismissedAt: row.dismissed_at,
    dismissedReason: row.dismissed_reason,
    generatorModel: row.generator_model,
    generatedAt: row.created_at,
    competitorName: row.intel_cards?.competitor_name,
    competitorPlatform: row.intel_cards?.platform,
  };
}

export async function listBriefs(
  tenantSlug: string,
  options: { includeDismissed?: boolean; limit?: number } = {}
): Promise<ContentBrief[]> {
  const supabase = await createClient();
  let query = supabase
    .from("content_briefs")
    .select("*, intel_cards!triggered_by(competitor_name, platform)")
    .eq("tenant_id", tenantSlug)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (!options.includeDismissed) {
    query = query.neq("status", "dismissed");
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as BriefRow[]).map(rowToBrief);
}

export async function getBrief(
  tenantSlug: string,
  briefId: string
): Promise<ContentBrief | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_briefs")
    .select("*, intel_cards!triggered_by(competitor_name, platform)")
    .eq("tenant_id", tenantSlug)
    .eq("id", briefId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToBrief(data as unknown as BriefRow);
}

/** Client-injected, status-filtered + offset-paginated twin of
 * listBriefs() for /api/v1 + MCP. */
export async function listBriefsApi(
  client: SupabaseClient,
  tenantSlug: string,
  filter: { status?: ContentBriefStatus; limit?: number; offset?: number } = {}
): Promise<{ data: ContentBrief[]; total: number }> {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;
  let query = client
    .from("content_briefs")
    .select("*, intel_cards!triggered_by(competitor_name, platform)", { count: "exact" })
    .eq("tenant_id", tenantSlug)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filter.status) query = query.eq("status", filter.status);
  else query = query.neq("status", "dismissed");
  const { data, error, count } = await query;
  if (error || !data) return { data: [], total: 0 };
  return { data: (data as unknown as BriefRow[]).map(rowToBrief), total: count ?? 0 };
}

/** Client-injected twin of generateBriefFromCard() (actions/briefs.ts)
 * — that file is `"use server"`, so its exports can't take a
 * SupabaseClient param. Duplicates its exact logic. Requires an
 * existing intel_cards row (cardId), not a free-text topic — same
 * constraint as the original action. AI-writing (real gpt-5 call), not
 * free to test, same cost class as prospects/:id/draft-dm. */
export async function generateAndSaveBrief(
  client: SupabaseClient,
  tenantSlug: string,
  cardId: string
): Promise<{ briefId: string } | { error: string }> {
  const { data: card, error: cardErr } = await client
    .from("intel_cards")
    .select("*")
    .eq("id", cardId)
    .eq("tenant_id", tenantSlug)
    .maybeSingle();
  if (cardErr || !card) return { error: "Intel card not found" };

  const [voice, tenant] = await Promise.all([getBrandVoice(tenantSlug), getTenantMeta(client, tenantSlug)]);
  if (!voice) return { error: "Brand voice not configured. Add one in Settings → Brand Voice." };
  if (!tenant) return { error: "Tenant not found" };

  const intelCard: IntelCard = {
    id: card.id,
    tenantId: card.tenant_id,
    competitorId: card.competitor_id,
    competitorName: card.competitor_name,
    competitorType: card.competitor_type,
    platform: card.platform,
    contentType: card.content_type,
    summary: card.summary,
    postUrl: card.post_url,
    metrics: card.metrics ?? {},
    aiRecommendation: card.ai_recommendation,
    detectedAt: card.detected_at,
    source: card.source,
  };
  const cluster: PatternCluster = {
    name: `${card.platform} ${card.content_type}`,
    key: `${card.platform}|${card.content_type}`,
    cards: [intelCard],
    avgVsAverage: intelCard.metrics.vsAverage ?? 1,
    avgEngagementRate: intelCard.metrics.engagementRate ?? 0,
  };

  try {
    const brief = await generateBrief({ tenantSlug, tenantName: tenant.name, cluster, voice });

    const { data: inserted, error } = await client
      .from("content_briefs")
      .insert({
        tenant_id: tenantSlug,
        triggered_by: cardId,
        triggered_by_type: "intel_card",
        platform: card.platform,
        content_type: card.content_type,
        title: brief.title,
        outline: brief.outline,
        draft_content: brief.draftContent,
        seo_keywords: brief.seoKeywords ?? [],
        status: "draft",
        generator_model: "openai/gpt-5",
      })
      .select("id")
      .single();
    if (error || !inserted) return { error: error?.message ?? "Insert failed" };

    return { briefId: inserted.id };
  } catch (err) {
    const msg =
      err instanceof BriefGenerationError
        ? "AI generation failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { error: msg };
  }
}
