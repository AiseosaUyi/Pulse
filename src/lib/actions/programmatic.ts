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
import { markdownToRichText } from "@/lib/seo/markdown-to-richtext";
import {
  resolveContentfulConfig,
  upsertSeoLandingPage,
  publishSeoLandingEntry,
  type PublishTarget,
} from "@/lib/integrations/contentful";
import { getTenantSeoConfig } from "@/lib/seo/tenant-seo-config";

// Derive the landing page's facet (category/location) for the live event grid
// from the template's variable KEYS — tenant-agnostic, no hardcoded taxonomy.
// A variable named category/topic/type → category; city/location/etc → location.
function deriveFacet(variables: Record<string, string>): {
  category: string | null;
  location: string | null;
} {
  let category: string | null = null;
  let location: string | null = null;
  for (const [key, value] of Object.entries(variables)) {
    const k = key.toLowerCase();
    const v = value.trim();
    if (!category && /(category|topic|type|genre|vertical)/.test(k)) {
      category = v.toLowerCase().replace(/\s+/g, "_");
    }
    if (!location && /(city|location|place|town|region|state|area)/.test(k)) {
      location = v;
    }
  }
  return { category, location };
}

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

// Publish a programmatic page to the tenant's live site as a `seoLandingPage`
// Contentful entry (rendered at <tenant-domain>/discover/<slug>). Idempotent by
// pulseId on the CMA side; records the entry id + live URL locally.
export async function publishProgrammaticPage(
  tenantSlug: string,
  id: string,
  target: PublishTarget = "live"
): Promise<ActionResult<{ liveUrl: string }>> {
  const cfg = await resolveContentfulConfig(tenantSlug, target);
  if (!cfg) {
    return {
      success: false,
      error:
        "Contentful isn't configured for this workspace — connect a Contentful integration (or set the env credentials) and provision the seoLandingPage content type.",
    };
  }

  const seo = await getTenantSeoConfig(tenantSlug);
  if (!seo.siteBaseUrl) {
    return {
      success: false,
      error:
        "Set this workspace's site domain (Settings) before publishing — it's needed to build the canonical URL.",
    };
  }

  // Test publishes go to the staging site (gamma) when configured; live → www.
  // The Contentful environment is already chosen by `target` via cfg.envId.
  const stagingBase = process.env.GRUVE_STAGING_BASE_URL?.trim();
  const siteBase =
    target === "test" && stagingBase ? stagingBase : seo.siteBaseUrl;

  const supabase = await createClient();
  const { data: page, error } = await supabase
    .from("programmatic_pages")
    .select(
      "id, slug, title, meta_description, body_md, variables"
    )
    .eq("id", id)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (error || !page) return { success: false, error: "Page not found" };
  if (!page.body_md) {
    return { success: false, error: "Page has no content to publish" };
  }

  const { category, location } = deriveFacet(
    (page.variables as Record<string, string>) ?? {}
  );
  const canonical = `${siteBase}${seo.landingRoutePrefix}/${page.slug}`;

  try {
    const bodyRichText = await markdownToRichText(page.body_md, cfg, page.title ?? undefined);
    const upserted = await upsertSeoLandingPage(
      {
        pulseId: page.id,
        title: page.title,
        slug: page.slug,
        description: page.meta_description ?? null,
        bodyRichText,
        category,
        location,
        seoTitle: page.title,
        seoDescription: page.meta_description ?? null,
        canonicalOverride: canonical,
      },
      cfg
    );
    await publishSeoLandingEntry(upserted.entryId, cfg);

    await supabase
      .from("programmatic_pages")
      .update({
        status: "published",
        contentful_entry_id: upserted.entryId,
        live_url: canonical,
        published_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_slug", tenantSlug);

    revalidatePath("/seo-tracker/programmatic");
    return { success: true, liveUrl: canonical };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Publish failed",
    };
  }
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
