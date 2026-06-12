"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getKeywordRankings } from "@/lib/services/seo";
import {
  clusterKeywords,
  type KeywordClustering,
} from "@/lib/ai/cluster-keywords";
import { generateSeoBlogFromTopic } from "@/lib/actions/seo-blog";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

const CLUSTER_MODEL = "openai/gpt-4.1";

// One draft linkage per suggested article: { "<cluster>::<title>": postId }
export type TopicalDraftMap = Record<string, string>;

export interface SavedTopicalMap {
  clustering: KeywordClustering;
  generatedAt: string;
  drafts: TopicalDraftMap;
}

function draftKey(clusterName: string, articleTitle: string): string {
  return `${clusterName}::${articleTitle}`;
}

/**
 * Read the persisted topical map for a tenant (survives navigation) plus the
 * map of which suggested articles have already been turned into drafts.
 */
export async function getLatestTopicalMap(
  tenantSlug: string
): Promise<SavedTopicalMap | null> {
  const supabase = await createClient();

  const { data: map } = await supabase
    .from("topical_maps")
    .select("clustering, generated_at")
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (!map) return null;

  const { data: drafts } = await supabase
    .from("topical_map_drafts")
    .select("cluster_name, article_title, blog_post_id")
    .eq("tenant_slug", tenantSlug);

  const draftMap: TopicalDraftMap = {};
  for (const d of drafts ?? []) {
    if (d.blog_post_id) {
      draftMap[draftKey(d.cluster_name, d.article_title)] = d.blog_post_id;
    }
  }

  return {
    clustering: map.clustering as KeywordClustering,
    generatedAt: map.generated_at as string,
    drafts: draftMap,
  };
}

/**
 * Generate (or regenerate) the topical map and PERSIST it so it survives
 * navigation. Overwrites the tenant's previous map.
 */
export async function generateTopicalMap(
  tenantSlug: string
): Promise<ActionResult<{ clustering: KeywordClustering }>> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const keywords = await getKeywordRankings(tenantSlug);
  if (keywords.length < 3) {
    return {
      success: false,
      error: `Need at least 3 tracked keywords to build a topical map (currently ${keywords.length}).`,
    };
  }

  try {
    const clustering = await clusterKeywords({
      tenantSlug,
      tenantName: tenant.name,
      keywords: keywords.map((k) => k.keyword),
    });

    const supabase = await createClient();
    await supabase
      .from("topical_maps")
      .upsert(
        {
          tenant_slug: tenantSlug,
          clustering,
          model: CLUSTER_MODEL,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_slug" }
      );

    revalidatePath("/seo-tracker/topical-map");
    return { success: true, clustering };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Clustering failed",
    };
  }
}

/**
 * Turn a suggested article into a real blog_posts draft (the action that makes
 * the topical map productive). Reuses the existing SEO generator, then records
 * the linkage so the UI can show "drafted" status. Idempotent per article.
 */
export async function generateDraftFromArticle(
  tenantSlug: string,
  input: { clusterName: string; articleTitle: string; primaryKeyword: string }
): Promise<ActionResult<{ postId: string }>> {
  const articleTitle = input.articleTitle.trim();
  const primaryKeyword = input.primaryKeyword.trim();
  if (!articleTitle || !primaryKeyword) {
    return { success: false, error: "Article title and keyword are required" };
  }

  const supabase = await createClient();

  // Idempotency: if this article already spawned a draft, return it.
  const { data: existing } = await supabase
    .from("topical_map_drafts")
    .select("blog_post_id")
    .eq("tenant_slug", tenantSlug)
    .eq("cluster_name", input.clusterName)
    .eq("article_title", articleTitle)
    .maybeSingle();
  if (existing?.blog_post_id) {
    return { success: true, postId: existing.blog_post_id };
  }

  const generated = await generateSeoBlogFromTopic({
    title: articleTitle,
    primaryKeyword,
  });
  if (!generated.success) {
    return { success: false, error: generated.error };
  }

  // Record the linkage (best-effort — the draft already exists either way).
  await supabase.from("topical_map_drafts").upsert(
    {
      tenant_slug: tenantSlug,
      cluster_name: input.clusterName,
      article_title: articleTitle,
      blog_post_id: generated.postId,
    },
    { onConflict: "tenant_slug,cluster_name,article_title" }
  );

  revalidatePath("/seo-tracker/topical-map");
  return { success: true, postId: generated.postId };
}
