import { createClient } from "@/lib/supabase/server";
import type {
  ProgrammaticTemplateRecord,
  ProgrammaticPageRecord,
  TemplateVariable,
  ProgrammaticPageStatus,
} from "@/lib/types/programmatic";

interface TemplateRow {
  id: string;
  tenant_slug: string;
  name: string;
  title_pattern: string;
  url_pattern: string;
  meta_description_pattern: string | null;
  content_prompt: string;
  target_word_count: number;
  variables: TemplateVariable[] | null;
  created_at: string;
  updated_at: string;
}

interface PageRow {
  id: string;
  tenant_slug: string;
  template_id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  body_md: string | null;
  variables: Record<string, string> | null;
  status: string;
  generator_model: string | null;
  generator_cost_usd: string | null;
  live_url: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

function templateRowTo(
  row: TemplateRow,
  pageCount: number
): ProgrammaticTemplateRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    name: row.name,
    titlePattern: row.title_pattern,
    urlPattern: row.url_pattern,
    metaDescriptionPattern: row.meta_description_pattern,
    contentPrompt: row.content_prompt,
    targetWordCount: row.target_word_count,
    variables: row.variables ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pageCount,
  };
}

function pageRowTo(row: PageRow): ProgrammaticPageRecord {
  const status: ProgrammaticPageStatus =
    row.status === "published" ? "published" : "draft";
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    templateId: row.template_id,
    slug: row.slug,
    title: row.title,
    metaDescription: row.meta_description,
    bodyMd: row.body_md,
    variables: row.variables ?? {},
    status,
    generatorModel: row.generator_model,
    liveUrl: row.live_url ?? null,
    publishedAt: row.published_at ?? null,
    generatorCostUsd: row.generator_cost_usd
      ? Number(row.generator_cost_usd)
      : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProgrammaticTemplates(
  tenantSlug: string
): Promise<ProgrammaticTemplateRecord[]> {
  const supabase = await createClient();
  const { data: templates, error } = await supabase
    .from("programmatic_templates")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("updated_at", { ascending: false });
  if (error || !templates) return [];

  const { data: counts } = await supabase
    .from("programmatic_pages")
    .select("template_id")
    .eq("tenant_slug", tenantSlug);

  const countMap = new Map<string, number>();
  for (const row of counts ?? []) {
    const tid = (row as { template_id: string }).template_id;
    countMap.set(tid, (countMap.get(tid) ?? 0) + 1);
  }

  return (templates as TemplateRow[]).map((t) =>
    templateRowTo(t, countMap.get(t.id) ?? 0)
  );
}

export async function getProgrammaticTemplate(
  tenantSlug: string,
  id: string
): Promise<ProgrammaticTemplateRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programmatic_templates")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const { count } = await supabase
    .from("programmatic_pages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_slug", tenantSlug)
    .eq("template_id", id);

  return templateRowTo(data as TemplateRow, count ?? 0);
}

export async function listProgrammaticPages(
  tenantSlug: string,
  templateId?: string
): Promise<ProgrammaticPageRecord[]> {
  const supabase = await createClient();
  let q = supabase
    .from("programmatic_pages")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (templateId) q = q.eq("template_id", templateId);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as PageRow[]).map(pageRowTo);
}
