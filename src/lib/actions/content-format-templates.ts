"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import type {
  ContentFormatTemplate,
  ContentMedium,
} from "@/lib/types/content-engine";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

async function assertOwnerOrAdmin(tenantSlug: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: roleData } = await supabase
    .rpc("tenant_role", { p_slug: tenantSlug })
    .single<string>();
  if (roleData !== "owner" && roleData !== "admin") {
    return "Only owners or admins can manage content formats";
  }
  return null;
}

export async function forkPlatformTemplate(
  tenantSlug: string,
  parentId: string
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const denial = await assertOwnerOrAdmin(tenantSlug);
  if (denial) return { success: false, error: denial };

  const admin = createAdminClient();
  const { data: parent, error: readErr } = await admin
    .from("content_format_templates")
    .select("*")
    .eq("id", parentId)
    .eq("scope", "platform")
    .single();

  if (readErr || !parent) {
    return { success: false, error: "Platform template not found" };
  }

  const { data: existing } = await admin
    .from("content_format_templates")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("parent_template_id", parentId)
    .maybeSingle();

  if (existing) {
    return { success: true, id: existing.id as string };
  }

  const { data: inserted, error: insertErr } = await admin
    .from("content_format_templates")
    .insert({
      scope: "tenant",
      tenant_slug: tenantSlug,
      parent_template_id: parentId,
      medium: parent.medium,
      name: parent.name,
      description: parent.description,
      category: parent.category,
      duration_min: parent.duration_min,
      duration_max: parent.duration_max,
      structure: parent.structure,
      tone: parent.tone,
      default_scenes: parent.default_scenes,
      example_hook: parent.example_hook,
      example_script: parent.example_script,
      is_active: true,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return {
      success: false,
      error: insertErr?.message ?? "Failed to fork template",
    };
  }

  revalidatePath("/settings/content-engine");
  return { success: true, id: inserted.id as string };
}

interface CreateInput {
  medium?: ContentMedium;
  name: string;
  description?: string | null;
  category?: string | null;
  durationMin: number;
  durationMax: number;
  structure: string[];
  tone?: string | null;
  defaultScenes: number;
  exampleHook?: string | null;
  exampleScript?: string | null;
}

export async function createTenantTemplate(
  tenantSlug: string,
  input: CreateInput
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const denial = await assertOwnerOrAdmin(tenantSlug);
  if (denial) return { success: false, error: denial };

  if (!input.name.trim()) {
    return { success: false, error: "Name is required" };
  }
  if (input.durationMin <= 0 || input.durationMax < input.durationMin) {
    return { success: false, error: "Invalid duration range" };
  }
  if (input.defaultScenes < 1) {
    return { success: false, error: "Scenes must be >= 1" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("content_format_templates")
    .insert({
      scope: "tenant",
      tenant_slug: tenantSlug,
      parent_template_id: null,
      medium: input.medium ?? "video",
      name: input.name.trim(),
      description: input.description ?? null,
      category: input.category ?? null,
      duration_min: input.durationMin,
      duration_max: input.durationMax,
      structure: input.structure,
      tone: input.tone ?? null,
      default_scenes: input.defaultScenes,
      example_hook: input.exampleHook ?? null,
      example_script: input.exampleScript ?? null,
      is_active: true,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath("/settings/content-engine");
  return { success: true, id: data.id as string };
}

interface UpdatePatch {
  name?: string;
  description?: string | null;
  category?: string | null;
  durationMin?: number;
  durationMax?: number;
  structure?: string[];
  tone?: string | null;
  defaultScenes?: number;
  exampleHook?: string | null;
  exampleScript?: string | null;
}

export async function updateTemplate(
  templateId: string,
  patch: UpdatePatch
): Promise<ActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("content_format_templates")
    .select("id, scope, tenant_slug")
    .eq("id", templateId)
    .single();

  if (!row) return { success: false, error: "Template not found" };
  if (row.scope !== "tenant") {
    return {
      success: false,
      error: "Platform templates are read-only. Customize first.",
    };
  }
  const denial = await assertOwnerOrAdmin(row.tenant_slug as string);
  if (denial) return { success: false, error: denial };

  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = patch.name.trim();
  if (patch.description !== undefined)
    dbPatch.description = patch.description;
  if (patch.category !== undefined) dbPatch.category = patch.category;
  if (patch.durationMin !== undefined) dbPatch.duration_min = patch.durationMin;
  if (patch.durationMax !== undefined) dbPatch.duration_max = patch.durationMax;
  if (patch.structure !== undefined) dbPatch.structure = patch.structure;
  if (patch.tone !== undefined) dbPatch.tone = patch.tone;
  if (patch.defaultScenes !== undefined)
    dbPatch.default_scenes = patch.defaultScenes;
  if (patch.exampleHook !== undefined) dbPatch.example_hook = patch.exampleHook;
  if (patch.exampleScript !== undefined)
    dbPatch.example_script = patch.exampleScript;

  const admin = createAdminClient();
  const { error } = await admin
    .from("content_format_templates")
    .update(dbPatch)
    .eq("id", templateId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/settings/content-engine");
  return { success: true };
}

export async function setTemplateActive(
  templateId: string,
  active: boolean
): Promise<ActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("content_format_templates")
    .select("id, scope, tenant_slug, parent_template_id, name, medium, description, category, duration_min, duration_max, structure, tone, default_scenes, example_hook, example_script")
    .eq("id", templateId)
    .single();

  if (!row) return { success: false, error: "Template not found" };

  const admin = createAdminClient();

  // Toggling a platform template requires an implicit fork — we can't
  // mutate the platform row, so we create a tenant-scope copy with the
  // requested active state. Caller must provide tenantSlug context.
  if (row.scope === "platform") {
    return {
      success: false,
      error:
        "Platform templates can't be toggled directly. Customize first, then toggle the fork.",
    };
  }

  const denial = await assertOwnerOrAdmin(row.tenant_slug as string);
  if (denial) return { success: false, error: denial };

  const { error } = await admin
    .from("content_format_templates")
    .update({ is_active: active })
    .eq("id", templateId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/settings/content-engine");
  return { success: true };
}

export async function deleteTemplate(
  templateId: string
): Promise<ActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("content_format_templates")
    .select("id, scope, tenant_slug")
    .eq("id", templateId)
    .single();

  if (!row) return { success: false, error: "Template not found" };
  if (row.scope !== "tenant") {
    return { success: false, error: "Platform templates can't be deleted." };
  }
  const denial = await assertOwnerOrAdmin(row.tenant_slug as string);
  if (denial) return { success: false, error: denial };

  const admin = createAdminClient();
  const { error } = await admin
    .from("content_format_templates")
    .delete()
    .eq("id", templateId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/settings/content-engine");
  return { success: true };
}

export type { ContentFormatTemplate };
