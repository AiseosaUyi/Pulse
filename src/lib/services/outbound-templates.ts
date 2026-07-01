import { createClient } from "@/lib/supabase/server";
import type {
  OutboundTemplateRecord,
  TemplateCritique,
  TemplatePlatform,
  TemplateStatus,
  TemplateType,
} from "@/lib/types/outbound-templates";

interface Row {
  id: string;
  tenant_slug: string;
  name: string;
  platform: TemplatePlatform;
  template_type: TemplateType;
  body: string;
  angle: string | null;
  status: TemplateStatus;
  is_primary: boolean;
  score: number | null;
  last_critique: TemplateCritique | null;
  last_scored_at: string | null;
  generator_model: string | null;
  generator_cost_usd: number | string | null;
  parent_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToTemplate(row: Row): OutboundTemplateRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    name: row.name,
    platform: row.platform,
    templateType: row.template_type ?? "cold_open",
    body: row.body,
    angle: row.angle,
    status: row.status,
    isPrimary: row.is_primary,
    score: row.score,
    lastCritique: row.last_critique,
    lastScoredAt: row.last_scored_at,
    generatorModel: row.generator_model,
    generatorCostUsd: Number(row.generator_cost_usd ?? 0),
    parentTemplateId: row.parent_template_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTemplates(
  tenantSlug: string,
  options: { status?: TemplateStatus | "all" } = {}
): Promise<OutboundTemplateRecord[]> {
  const supabase = await createClient();
  let query = supabase
    .from("outbound_templates")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("is_primary", { ascending: false })
    .order("updated_at", { ascending: false });
  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  } else if (!options.status) {
    query = query.neq("status", "archived");
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as Row[]).map(rowToTemplate);
}

export async function getTemplateByType(
  tenantSlug: string,
  platform: TemplatePlatform,
  templateType: TemplateType
): Promise<OutboundTemplateRecord | null> {
  const supabase = await createClient();
  // Prefer exact platform + type, then any platform + type, then any primary
  const { data } = await supabase
    .from("outbound_templates")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("template_type", templateType)
    .in("platform", [platform, "any"])
    .neq("status", "archived")
    .order("is_primary", { ascending: false })
    .order("platform", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return rowToTemplate(data as Row);
}

export async function getPrimaryTemplate(
  tenantSlug: string,
  platform: TemplatePlatform
): Promise<OutboundTemplateRecord | null> {
  const supabase = await createClient();
  // Try the exact platform first, fall back to `any`.
  const { data } = await supabase
    .from("outbound_templates")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("is_primary", true)
    .in("platform", [platform, "any"])
    .order("platform", { ascending: false }) // exact platform beats 'any'
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return rowToTemplate(data as Row);
}

export async function getTemplate(
  tenantSlug: string,
  id: string
): Promise<OutboundTemplateRecord | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outbound_templates")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return rowToTemplate(data as Row);
}
