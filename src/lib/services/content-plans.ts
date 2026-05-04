// Read-side service for content_plans. Reads obey RLS via the SSR
// client (members see their own tenant's plans only).

import { createClient } from "@/lib/supabase/server";
import type {
  ContentPlan,
  ContentPlanFeedback,
  ContentPlanOutput,
  ContentPlanStatus,
  SuggestedTool,
} from "@/lib/types/content-engine";

interface RawPlanRow {
  id: string;
  tenant_slug: string;
  template_id: string | null;
  template_name: string;
  template_category: string | null;
  medium: "video";
  platform: string;
  output: ContentPlanOutput;
  predicted_virality: number | null;
  predicted_education: number | null;
  predicted_conversion: number | null;
  suggested_tool: SuggestedTool | null;
  suggested_tool_reason: string | null;
  status: ContentPlanStatus;
  feedback: ContentPlanFeedback;
  feedback_notes: string | null;
  generator_model: string | null;
  generator_cost_usd: number | string | null;
  batch_id: string;
  created_at: string;
  updated_at: string;
}

function hydrate(row: RawPlanRow): ContentPlan {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    templateId: row.template_id,
    templateName: row.template_name,
    templateCategory: row.template_category,
    medium: row.medium,
    platform: row.platform,
    output: row.output,
    predictedVirality: row.predicted_virality,
    predictedEducation: row.predicted_education,
    predictedConversion: row.predicted_conversion,
    suggestedTool: row.suggested_tool,
    suggestedToolReason: row.suggested_tool_reason,
    status: row.status,
    feedback: row.feedback,
    feedbackNotes: row.feedback_notes,
    generatorModel: row.generator_model,
    generatorCostUsd:
      row.generator_cost_usd != null
        ? Number(row.generator_cost_usd)
        : null,
    batchId: row.batch_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ListOptions {
  limit?: number;
  status?: ContentPlanStatus;
  platform?: string;
}

export async function listForTenant(
  tenantSlug: string,
  opts: ListOptions = {}
): Promise<ContentPlan[]> {
  const supabase = await createClient();
  let q = supabase
    .from("content_plans")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 30);

  if (opts.status) q = q.eq("status", opts.status);
  if (opts.platform) q = q.eq("platform", opts.platform);

  const { data } = await q;
  return (data ?? []).map((r) => hydrate(r as RawPlanRow));
}

export async function listByBatch(
  tenantSlug: string,
  batchId: string
): Promise<ContentPlan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("content_plans")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => hydrate(r as RawPlanRow));
}

export async function getPlanById(
  id: string
): Promise<ContentPlan | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("content_plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ? hydrate(data as RawPlanRow) : null;
}
