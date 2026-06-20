"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import {
  CONTENT_PLATFORMS,
  type ContentItem,
  type ContentItemStatus,
  type ContentPlatform,
} from "@/lib/types/content-pipeline";
import { slugifyContentType, SLUG_RE } from "@/lib/content-pipeline/slug";

const STATUS_VALUES: ContentItemStatus[] = [
  "not_posted",
  "scheduled",
  "posted",
  "archived",
  "draft",
];

const platformSchema = z.enum(CONTENT_PLATFORMS as [ContentPlatform, ...ContentPlatform[]]);

const createSchema = z.object({
  sectionSlug: z.string().min(1),
  title: z.string().min(1).max(200),
  contentTypeSlug: z.string().nullable().optional(),
  platforms: z.array(platformSchema).default([]),
  // Storage: exactly one of the two blocks must be provided.
  storageProvider: z.enum(["drive", "r2"]).default("r2"),
  // R2 upload fields
  storageKey: z.string().nullable().optional(),
  storageUrl: z.string().nullable().optional(),
  // Drive upload fields (legacy)
  driveFileId: z.string().nullable().optional(),
  driveMimeType: z.string().nullable().optional(),
  driveSizeBytes: z.number().int().nonnegative().nullable().optional(),
  driveWebViewLink: z.string().url().nullable().optional(),
  thumbnailStorageKey: z.string().nullable().optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  contentTypeSlug: z.string().nullable().optional(),
  status: z.enum(STATUS_VALUES as [ContentItemStatus, ...ContentItemStatus[]]).optional(),
  platforms: z.array(platformSchema).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

async function requireTenantMember(): Promise<
  | { ok: true; tenantSlug: string; userId: string }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "No tenant" };
  return { ok: true, tenantSlug: tenant.slug, userId: user.id };
}

// ── CRUD ─────────────────────────────────────────────────────

export async function createContentItem(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .insert({
      tenant_slug: auth.tenantSlug,
      section_slug: v.sectionSlug,
      title: v.title,
      content_type_slug: v.contentTypeSlug ?? null,
      platforms: v.platforms,
      storage_provider: v.storageProvider,
      storage_key: v.storageKey ?? null,
      storage_url: v.storageUrl ?? null,
      drive_file_id: v.driveFileId ?? null,
      drive_mime_type: v.driveMimeType ?? null,
      drive_size_bytes: v.driveSizeBytes ?? null,
      drive_web_view_link: v.driveWebViewLink ?? null,
      thumbnail_storage_key: v.thumbnailStorageKey ?? null,
      thumbnail_cached_at: v.thumbnailStorageKey ? new Date().toISOString() : null,
      uploaded_by: auth.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }
  revalidatePath("/content-vault/pipeline");
  return { ok: true, data: { id: data.id } };
}

export async function updateContentItem(
  input: z.infer<typeof updateSchema>
): Promise<ActionResult> {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth;
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  const update: Record<string, unknown> = {};
  if (v.title !== undefined) update.title = v.title;
  if (v.contentTypeSlug !== undefined)
    update.content_type_slug = v.contentTypeSlug;
  if (v.status !== undefined) update.status = v.status;
  if (v.platforms !== undefined) update.platforms = v.platforms;
  if (v.scheduledAt !== undefined) update.scheduled_at = v.scheduledAt;
  if (v.assignedTo !== undefined) update.assigned_to = v.assignedTo;

  if (Object.keys(update).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("content_items")
    .update(update)
    .eq("id", v.id)
    .eq("tenant_slug", auth.tenantSlug);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/content-vault/pipeline");
  return { ok: true };
}

export async function deleteContentItem(
  id: string
): Promise<ActionResult> {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_items")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", auth.tenantSlug);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/content-vault/pipeline");
  return { ok: true };
}

export async function markPosted(
  id: string,
  postedUrl?: string
): Promise<ActionResult> {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth;
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const url = postedUrl?.trim() || null;
  if (url && !z.string().url().safeParse(url).success) {
    return { ok: false, error: "Posted URL must be a valid URL" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("content_items")
    .update({
      status: "posted",
      posted_at: new Date().toISOString(),
      posted_url: url,
    })
    .eq("id", id)
    .eq("tenant_slug", auth.tenantSlug);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/content-vault/pipeline");
  return { ok: true };
}

// ── Custom content types ─────────────────────────────────────

export async function createCustomContentType(
  label: string
): Promise<ActionResult<{ slug: string; label: string }>> {
  const auth = await requireTenantMember();
  if (!auth.ok) return auth;
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 40) {
    return { ok: false, error: "Label must be 1-40 characters" };
  }
  const slug = slugifyContentType(trimmed);
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: "Label must produce a valid slug" };
  }
  const supabase = await createClient();
  // Slugify-only dedup — direct insert; PK collision = exists.
  const { error } = await supabase.from("content_types").insert({
    tenant_slug: auth.tenantSlug,
    slug,
    label: trimmed,
    is_default: false,
    created_by: auth.userId,
  });
  if (error) {
    // 23505 = unique_violation — friendly message
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: `"${trimmed}" already exists` };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath("/content-vault/pipeline");
  return { ok: true, data: { slug, label: trimmed } };
}
