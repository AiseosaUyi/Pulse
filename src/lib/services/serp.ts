import { createClient } from "@/lib/supabase/server";
import type { SerpAnalysisRecord } from "@/lib/types/serp";
import type { SerpResult } from "@/lib/scrape/google-serp";
import type { SerpAnalysis } from "@/lib/ai/analyze-serp";

interface Row {
  id: string;
  tenant_slug: string;
  keyword: string;
  region: string | null;
  top_results: SerpResult[] | null;
  ai_analysis: SerpAnalysis | null;
  generator_model: string | null;
  generator_cost_usd: string | null;
  created_at: string;
  updated_at: string;
}

function rowTo(row: Row): SerpAnalysisRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    keyword: row.keyword,
    region: row.region,
    topResults: row.top_results ?? [],
    aiAnalysis: row.ai_analysis,
    generatorModel: row.generator_model,
    generatorCostUsd: row.generator_cost_usd ? Number(row.generator_cost_usd) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSerpAnalyses(
  tenantSlug: string
): Promise<SerpAnalysisRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serp_analyses")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

export async function getSerpAnalysis(
  tenantSlug: string,
  keyword: string
): Promise<SerpAnalysisRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serp_analyses")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("keyword", keyword)
    .maybeSingle();
  if (error || !data) return null;
  return rowTo(data as Row);
}
