"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { scrapeGoogleSerp } from "@/lib/scrape/google-serp";
import { analyzeSerp } from "@/lib/ai/analyze-serp";
import { generateSeoBlogFromTopic } from "@/lib/actions/seo-blog";
import { getTenantSeoConfig } from "@/lib/seo/tenant-seo-config";

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

  // Region: explicit input wins, else the tenant's primary region (no hardcoded
  // country — Pulse is multi-tenant).
  const seo = await getTenantSeoConfig(tenantSlug);
  const region = input.region?.trim() || seo.serpRegion;

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

// "Create draft from gap": turn a SERP analysis into a real blog_posts draft.
// Reuses the SEO generator (which re-fetches a fresh SERP snapshot for the
// keyword, so the competitor gap is baked into generation) → review → publish.
export async function createDraftFromSerp(
  tenantSlug: string,
  analysisId: string
): Promise<ActionResult<{ postId: string }>> {
  const supabase = await createClient();
  const { data: analysis, error } = await supabase
    .from("serp_analyses")
    .select("keyword")
    .eq("id", analysisId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (error || !analysis) {
    return { success: false, error: "SERP analysis not found" };
  }

  const generated = await generateSeoBlogFromTopic({
    title: analysis.keyword,
    primaryKeyword: analysis.keyword,
  });
  if (!generated.success) {
    return { success: false, error: generated.error };
  }
  return { success: true, postId: generated.postId };
}

// "Generate optimization edits": if a published post already targets this
// keyword, surface a content_refresh recommendation carrying the SERP gap as
// concrete edit guidance — routed through the existing review/approval queue
// so the Gruve team edits before re-publishing. Measurable via the 30-day
// baseline captured on apply (rec-outcomes.ts).
export async function createEditRecFromSerp(
  tenantSlug: string,
  analysisId: string
): Promise<ActionResult<{ recId: string; postId: string }>> {
  const supabase = await createClient();

  const { data: analysis, error } = await supabase
    .from("serp_analyses")
    .select("keyword, ai_analysis")
    .eq("id", analysisId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (error || !analysis) {
    return { success: false, error: "SERP analysis not found" };
  }

  // Find a published post already targeting this keyword.
  const { data: post } = await supabase
    .from("blog_posts")
    .select("id, slug")
    .eq("tenant_slug", tenantSlug)
    .eq("status", "published")
    .ilike("target_keyword", analysis.keyword)
    .limit(1)
    .maybeSingle();

  if (!post) {
    return {
      success: false,
      error:
        "No published post targets this keyword yet. Use “Create draft from gap” to write one.",
    };
  }

  const ai = (analysis.ai_analysis ?? {}) as {
    gap_for_us?: string;
    our_angle?: string;
    how_to_compete?: string;
    content_length_hint?: string;
  };

  const { data: rec, error: recErr } = await supabase
    .from("seo_recommendations")
    .insert({
      tenant_slug: tenantSlug,
      blog_post_id: post.id,
      slug: post.slug ?? null,
      type: "content_refresh",
      payload: {
        source: "serp_analysis",
        keyword: analysis.keyword,
        reason: ai.gap_for_us ?? "SERP gap identified",
        our_angle: ai.our_angle ?? null,
        how_to_compete: ai.how_to_compete ?? null,
        content_length_hint: ai.content_length_hint ?? null,
      },
      score: 0.7,
      status: "surfaced",
    })
    .select("id")
    .single();

  if (recErr || !rec) {
    return { success: false, error: recErr?.message ?? "Could not create recommendation" };
  }

  return { success: true, recId: rec.id, postId: post.id };
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
