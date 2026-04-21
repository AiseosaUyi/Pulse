"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import {
  scoreTemplateAi,
  TemplateCritiqueError,
  type TemplateCritiqueResult,
} from "@/lib/ai/score-template";
import {
  generateTemplateVariantsAi,
  TemplateGenerationError,
  type TemplateVariantsResult,
} from "@/lib/ai/generate-template";
import {
  getPrimaryTemplate,
  getTemplate,
  rowToTemplate,
} from "@/lib/services/outbound-templates";
import type {
  OutboundTemplateRecord,
  TemplatePlatform,
  TemplateStatus,
} from "@/lib/types/outbound-templates";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export interface CreateTemplateInput {
  name: string;
  platform: TemplatePlatform;
  body: string;
  angle?: string;
  makePrimary?: boolean;
  /** Populated when the template was generated from AI. */
  generatorModel?: string;
  generatorCostUsd?: number;
  parentTemplateId?: string;
}

export async function createTemplate(
  tenantSlug: string,
  input: CreateTemplateInput
): Promise<ActionResult<{ template: OutboundTemplateRecord }>> {
  const user = await requireUser();
  if (!input.name.trim() || !input.body.trim()) {
    return { success: false, error: "Name and body are required" };
  }

  const supabase = await createClient();

  // Enforce "only one primary per platform" — if the caller wants
  // this new one primary, demote the existing primary first.
  if (input.makePrimary) {
    await supabase
      .from("outbound_templates")
      .update({ is_primary: false })
      .eq("tenant_slug", tenantSlug)
      .eq("platform", input.platform)
      .eq("is_primary", true);
  }

  const { data, error } = await supabase
    .from("outbound_templates")
    .insert({
      tenant_slug: tenantSlug,
      name: input.name.trim(),
      platform: input.platform,
      body: input.body.trim(),
      angle: input.angle?.trim() || null,
      is_primary: Boolean(input.makePrimary),
      generator_model: input.generatorModel ?? null,
      generator_cost_usd: input.generatorCostUsd ?? 0,
      parent_template_id: input.parentTemplateId ?? null,
      created_by: user.id,
    })
    .select("*")
    .single();
  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath("/leads");
  return { success: true, template: rowToTemplate(data) };
}

export async function updateTemplate(
  tenantSlug: string,
  id: string,
  patch: {
    name?: string;
    body?: string;
    angle?: string | null;
    platform?: TemplatePlatform;
    status?: TemplateStatus;
  }
): Promise<ActionResult> {
  await requireUser();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.body !== undefined) update.body = patch.body.trim();
  if (patch.angle !== undefined)
    update.angle = patch.angle ? patch.angle.trim() : null;
  if (patch.platform !== undefined) update.platform = patch.platform;
  if (patch.status !== undefined) update.status = patch.status;
  if (Object.keys(update).length === 0) {
    return { success: false, error: "No changes" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("outbound_templates")
    .update(update)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function setPrimaryTemplate(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  await requireUser();
  const template = await getTemplate(tenantSlug, id);
  if (!template) return { success: false, error: "Template not found" };

  const supabase = await createClient();
  // Demote any existing primary on the same platform first, then
  // promote this one. Two separate updates keep the partial unique
  // index happy.
  await supabase
    .from("outbound_templates")
    .update({ is_primary: false })
    .eq("tenant_slug", tenantSlug)
    .eq("platform", template.platform)
    .eq("is_primary", true);

  const { error } = await supabase
    .from("outbound_templates")
    .update({ is_primary: true, status: "active" })
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function deleteTemplate(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("outbound_templates")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function scoreTemplate(
  tenantSlug: string,
  id: string
): Promise<ActionResult<{ critique: TemplateCritiqueResult }>> {
  await requireUser();
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  const template = await getTemplate(tenantSlug, id);
  if (!template) return { success: false, error: "Template not found" };

  try {
    const { voice, positioning } = await getBrandContext(tenantSlug);
    const { critique } = await scoreTemplateAi({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      template: {
        platform: template.platform,
        body: template.body,
        angle: template.angle,
      },
    });

    const supabase = await createClient();
    await supabase
      .from("outbound_templates")
      .update({
        score: critique.overall_score,
        last_critique: critique,
        last_scored_at: new Date().toISOString(),
      })
      .eq("tenant_slug", tenantSlug)
      .eq("id", id);

    revalidatePath("/leads");
    return { success: true, critique };
  } catch (err) {
    const msg =
      err instanceof TemplateCritiqueError
        ? "Scoring failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}

/**
 * Score an ad-hoc body that hasn't been saved yet — lets the user
 * paste a draft and see the verdict before committing to saving it.
 */
export async function scoreTemplateDraft(
  tenantSlug: string,
  draft: { body: string; platform: TemplatePlatform; angle?: string }
): Promise<ActionResult<{ critique: TemplateCritiqueResult }>> {
  await requireUser();
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  if (!draft.body.trim()) return { success: false, error: "Body is empty" };

  try {
    const { voice, positioning } = await getBrandContext(tenantSlug);
    const { critique } = await scoreTemplateAi({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      template: {
        platform: draft.platform,
        body: draft.body,
        angle: draft.angle ?? null,
      },
    });
    return { success: true, critique };
  } catch (err) {
    const msg =
      err instanceof TemplateCritiqueError
        ? "Scoring failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}

export interface GenerateTemplatesInput {
  audience: string;
  angle: string;
  platform: TemplatePlatform;
  /** If provided, variants are written to be distinct from this one. */
  seedBody?: string;
}

export async function generateTemplateVariants(
  tenantSlug: string,
  input: GenerateTemplatesInput
): Promise<
  ActionResult<{
    variants: TemplateVariantsResult["variants"];
    model: string;
    costUsd: number;
  }>
> {
  await requireUser();
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  if (!input.audience.trim() || !input.angle.trim()) {
    return { success: false, error: "Audience and angle are required" };
  }

  try {
    const { voice, positioning } = await getBrandContext(tenantSlug);
    const { variants, model, costUsd } = await generateTemplateVariantsAi({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      brief: {
        audience: input.audience.trim(),
        angle: input.angle.trim(),
        platform: input.platform,
        avoidSimilarityTo: input.seedBody?.trim() || undefined,
      },
    });
    return { success: true, variants, model, costUsd };
  } catch (err) {
    const msg =
      err instanceof TemplateGenerationError
        ? "Variant generation failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}

/**
 * Used by the extension + Pipeline "Copy primary" action. Returns
 * the primary template body for the given platform (falling back
 * to the tenant's `any` primary if no platform-specific primary
 * exists).
 */
export async function resolvePrimaryTemplate(
  tenantSlug: string,
  platform: TemplatePlatform
): Promise<ActionResult<{ template: OutboundTemplateRecord | null }>> {
  await requireUser();
  const template = await getPrimaryTemplate(tenantSlug, platform);
  return { success: true, template };
}
