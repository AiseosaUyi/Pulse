"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant, requireUser } from "@/lib/auth";
import { storeVideoAsset } from "@/lib/video/assets";

type Result<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function createCharacter(input: {
  name: string;
  description?: string;
  identityPrompt?: string;
  defaultAspectRatio?: string;
}): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (!input.name.trim()) return { success: false, error: "Name is required" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("video_characters")
    .insert({
      tenant_slug: tenant.slug,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      identity_prompt: input.identityPrompt?.trim() || null,
      default_aspect_ratio: input.defaultAspectRatio || "9:16",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "Failed" };
  revalidatePath("/video/characters");
  return { success: true, id: data.id };
}

export async function updateCharacter(
  id: string,
  patch: { name?: string; description?: string; identityPrompt?: string }
): Promise<Result> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("video_characters")
    .update({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() || null } : {}),
      ...(patch.identityPrompt !== undefined ? { identity_prompt: patch.identityPrompt.trim() || null } : {}),
    })
    .eq("id", id)
    .eq("tenant_slug", tenant.slug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/video/characters");
  return { success: true };
}

export async function archiveCharacter(id: string): Promise<Result> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("video_characters")
    .update({ status: "archived" })
    .eq("id", id)
    .eq("tenant_slug", tenant.slug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/video/characters");
  return { success: true };
}

// Upload one reference image and append it to the character (max 9).
export async function addCharacterReference(
  characterId: string,
  formData: FormData
): Promise<Result<{ assetId: string }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "No file provided" };
  if (!file.type.startsWith("image/")) return { success: false, error: "Reference must be an image" };

  const supabase = await createClient();
  const { data: ch } = await supabase
    .from("video_characters")
    .select("reference_asset_ids")
    .eq("id", characterId)
    .eq("tenant_slug", tenant.slug)
    .maybeSingle();
  if (!ch) return { success: false, error: "Character not found" };
  const current = (ch.reference_asset_ids as string[]) ?? [];
  if (current.length >= 9) return { success: false, error: "A character can have at most 9 reference images" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await storeVideoAsset({
    tenantSlug: tenant.slug,
    bytes,
    mime: file.type,
    kind: "image",
    role: "character_ref",
    createdBy: user.id,
  });

  const admin = createAdminClient();
  await admin
    .from("video_characters")
    .update({ reference_asset_ids: [...current, stored.id] })
    .eq("id", characterId);
  revalidatePath("/video/characters");
  return { success: true, assetId: stored.id };
}

export async function removeCharacterReference(
  characterId: string,
  assetId: string
): Promise<Result> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  const supabase = await createClient();
  const { data: ch } = await supabase
    .from("video_characters")
    .select("reference_asset_ids")
    .eq("id", characterId)
    .eq("tenant_slug", tenant.slug)
    .maybeSingle();
  if (!ch) return { success: false, error: "Character not found" };
  const next = ((ch.reference_asset_ids as string[]) ?? []).filter((x) => x !== assetId);
  const admin = createAdminClient();
  await admin.from("video_characters").update({ reference_asset_ids: next }).eq("id", characterId);
  revalidatePath("/video/characters");
  return { success: true };
}
