"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { scrapeGoogleSerp } from "@/lib/scrape/google-serp";
import { analyzeSerp } from "@/lib/ai/analyze-serp";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function analyzeSerpForKeyword(
  tenantSlug: string,
  input: { keyword: string; region?: string }
): Promise<ActionResult<{ analysisId: string }>> {
  const keyword = input.keyword.trim();
  if (!keyword) return { success: false, error: "Keyword is required" };

  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const region = input.region?.trim() || "ng";

  try {
    const results = await scrapeGoogleSerp({ query: keyword, region, limit: 10 });
    if (results.length === 0) {
      return {
        success: false,
        error:
          "Scraper returned no results. Check APIFY_SERP_ACTOR_ID in Vercel env or try a different keyword.",
      };
    }

    const voice = await getBrandVoice(tenantSlug);
    const { analysis, costUsd } = await analyzeSerp({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      keyword,
      region,
      results,
    });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("serp_analyses")
      .upsert(
        {
          tenant_slug: tenantSlug,
          keyword,
          region,
          top_results: results,
          ai_analysis: analysis,
          generator_model: "openai/gpt-4.1",
          generator_cost_usd: costUsd,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_slug,keyword" }
      )
      .select("id")
      .single();

    if (error || !data) {
      return { success: false, error: error?.message ?? "Insert failed" };
    }

    revalidatePath("/seo-tracker/serp-analysis");
    return { success: true, analysisId: data.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "SERP analysis failed",
    };
  }
}

export async function deleteSerpAnalysis(
  id: string,
  tenantSlug: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("serp_analyses")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/serp-analysis");
  return { success: true };
}
