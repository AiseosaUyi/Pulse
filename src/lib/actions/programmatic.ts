"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import {
  generateProgrammaticPage,
  expandVariables,
  interpolate,
  slugify,
} from "@/lib/ai/generate-programmatic-page";
import type { TemplateVariable } from "@/lib/types/programmatic";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

interface TemplateInput {
  name: string;
  titlePattern: string;
  urlPattern: string;
  metaDescriptionPattern?: string | null;
  contentPrompt: string;
  targetWordCount?: number;
  variables: TemplateVariable[];
}

function validateVariables(variables: TemplateVariable[]): string | null {
  if (!Array.isArray(variables)) return "Variables must be an array";
  for (const v of variables) {
    if (!v.name?.trim()) return "Every variable needs a name";
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(v.name)) {
      return `Variable "${v.name}" must be alphanumeric (no spaces/hyphens)`;
    }
    if (!Array.isArray(v.values) || v.values.length === 0) {
      return `Variable "${v.name}" needs at least one value`;
    }
    for (const val of v.values) {
      if (!val?.trim()) return `Variable "${v.name}" has a blank value`;
    }
  }
  return null;
}

export async function createProgrammaticTemplate(
  tenantSlug: string,
  input: TemplateInput
): Promise<ActionResult<{ id: string }>> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const name = input.name.trim();
  const titlePattern = input.titlePattern.trim();
  const urlPattern = input.urlPattern.trim();
  const contentPrompt = input.contentPrompt.trim();
  if (!name || !titlePattern || !urlPattern || !contentPrompt) {
    return { success: false, error: "Name, title, URL, and prompt are required" };
  }

  const varError = validateVariables(input.variables);
  if (varError) return { success: false, error: varError };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programmatic_templates")
    .insert({
      tenant_slug: tenantSlug,
      name,
      title_pattern: titlePattern,
      url_pattern: urlPattern,
      meta_description_pattern: input.metaDescriptionPattern?.trim() || null,
      content_prompt: contentPrompt,
      target_word_count: input.targetWordCount ?? 600,
      variables: input.variables,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }
  revalidatePath("/seo-tracker/programmatic");
  return { success: true, id: data.id };
}

export async function updateProgrammaticTemplate(
  tenantSlug: string,
  id: string,
  input: TemplateInput
): Promise<ActionResult> {
  const varError = validateVariables(input.variables);
  if (varError) return { success: false, error: varError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("programmatic_templates")
    .update({
      name: input.name.trim(),
      title_pattern: input.titlePattern.trim(),
      url_pattern: input.urlPattern.trim(),
      meta_description_pattern: input.metaDescriptionPattern?.trim() || null,
      content_prompt: input.contentPrompt.trim(),
      target_word_count: input.targetWordCount ?? 600,
      variables: input.variables,
    })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);

  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/programmatic");
  return { success: true };
}

export async function deleteProgrammaticTemplate(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("programmatic_templates")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/programmatic");
  return { success: true };
}

export async function generatePagesFromTemplate(
  tenantSlug: string,
  templateId: string,
  options: { skipExisting?: boolean } = {}
): Promise<
  ActionResult<{ generated: number; skipped: number; failed: number; failures: string[] }>
> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const supabase = await createClient();
  const { data: tpl, error: tplError } = await supabase
    .from("programmatic_templates")
    .select("*")
    .eq("id", templateId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (tplError || !tpl) {
    return { success: false, error: "Template not found" };
  }

  const variables = (tpl.variables as TemplateVariable[]) ?? [];
  const combos = expandVariables(variables);
  if (combos.length === 0 || (combos.length === 1 && Object.keys(combos[0]).length === 0)) {
    return { success: false, error: "Template has no variable combinations" };
  }
  if (combos.length > 100) {
    return {
      success: false,
      error: `Would generate ${combos.length} pages — cap is 100 per run. Split variables into smaller sets.`,
    };
  }

  let existingSlugs = new Set<string>();
  if (options.skipExisting) {
    const { data: existing } = await supabase
      .from("programmatic_pages")
      .select("slug")
      .eq("template_id", templateId)
      .eq("tenant_slug", tenantSlug);
    existingSlugs = new Set((existing ?? []).map((r) => (r as { slug: string }).slug));
  }

  const voice = await getBrandVoice(tenantSlug);

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const combo of combos) {
    const resolvedUrl = interpolate(tpl.url_pattern, combo);
    const slug = slugify(resolvedUrl);

    if (existingSlugs.has(slug)) {
      skipped += 1;
      continue;
    }

    try {
      const { page, costUsd } = await generateProgrammaticPage({
        tenantSlug,
        tenantName: tenant.name,
        voice,
        titlePattern: tpl.title_pattern,
        metaDescriptionPattern: tpl.meta_description_pattern,
        contentPrompt: tpl.content_prompt,
        targetWordCount: tpl.target_word_count,
        variables: combo,
      });

      const { error: insertError } = await supabase
        .from("programmatic_pages")
        .upsert(
          {
            tenant_slug: tenantSlug,
            template_id: templateId,
            slug,
            title: page.title,
            meta_description: page.meta_description,
            body_md: page.body_md,
            variables: combo,
            status: "draft",
            generator_model: "openai/gpt-4.1",
            generator_cost_usd: costUsd,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "template_id,slug" }
        );

      if (insertError) {
        failed += 1;
        failures.push(`${slug}: ${insertError.message}`);
      } else {
        generated += 1;
      }
    } catch (err) {
      failed += 1;
      failures.push(
        `${slug}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  revalidatePath("/seo-tracker/programmatic");
  return { success: true, generated, skipped, failed, failures };
}

export async function deleteProgrammaticPage(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("programmatic_pages")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/programmatic");
  return { success: true };
}

export async function updateProgrammaticPageStatus(
  tenantSlug: string,
  id: string,
  status: "draft" | "published"
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("programmatic_pages")
    .update({ status })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/programmatic");
  return { success: true };
}
