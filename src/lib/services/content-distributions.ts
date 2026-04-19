import { createClient } from "@/lib/supabase/server";
import type {
  ContentDistributionRecord,
  DistributionFormat,
  DistributionStatus,
} from "@/lib/types/content-distributions";

interface Row {
  id: string;
  tenant_slug: string;
  blog_post_id: string;
  format: DistributionFormat;
  content: string;
  status: DistributionStatus;
  scheduled_at: string | null;
  generator_model: string | null;
  generator_cost_usd: number | string | null;
  created_at: string;
  updated_at: string;
}

function rowTo(row: Row): ContentDistributionRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    blogPostId: row.blog_post_id,
    format: row.format,
    content: row.content,
    status: row.status,
    scheduledAt: row.scheduled_at,
    generatorModel: row.generator_model,
    generatorCostUsd: Number(row.generator_cost_usd ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDistributionsForBlogPost(
  tenantSlug: string,
  blogPostId: string
): Promise<ContentDistributionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_distributions")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("blog_post_id", blogPostId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

export async function getDistribution(
  tenantSlug: string,
  id: string
): Promise<ContentDistributionRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_distributions")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowTo(data as Row);
}
