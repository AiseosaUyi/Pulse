"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant, requireUser } from "@/lib/auth";

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

// Register a reference image (already uploaded to storage via a signed URL)
// and append it to the character (max 9). The browser uploads the bytes
// directly to R2 via presigned PUT — see createSignedVideoUpload — so this never
// hits the 1 MB server-action body limit.
export async function registerCharacterReference(
  characterId: string,
  key: string
): Promise<Result<{ assetId: string }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (!key.startsWith(`videos/${tenant.slug}/`)) {
    return { success: false, error: "Invalid upload key" };
  }

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

  const { r2PublicUrl } = await import("@/lib/storage/r2");
  const storageUrl = r2PublicUrl(key);
  const admin = createAdminClient();
  const { data: asset, error } = await admin
    .from("video_assets")
    .insert({
      tenant_slug: tenant.slug,
      kind: "image",
      role: "character_ref",
      storage_url: storageUrl,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !asset) return { success: false, error: error?.message ?? "Register failed" };

  await admin
    .from("video_characters")
    .update({ reference_asset_ids: [...current, asset.id] })
    .eq("id", characterId);
  revalidatePath("/video/characters");
  return { success: true, assetId: asset.id };
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
