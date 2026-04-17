"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";

const PLATFORMS = ["instagram", "tiktok", "twitter", "linkedin"] as const;
const CONTENT_TYPES = ["video", "image", "carousel", "text"] as const;

function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function num(formData: FormData, key: string): number {
  const raw = str(formData, key);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function createPost(formData: FormData) {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const title = str(formData, "title");
  const platform = formData.get("platform");
  const contentType = formData.get("contentType");
  const postedAt = str(formData, "postedAt");
  const postUrl = str(formData, "postUrl") || null;
  const notes = str(formData, "notes") || null;

  if (!title) return { success: false, error: "Title is required" };
  if (!isOneOf(PLATFORMS, platform)) return { success: false, error: "Select a platform" };
  if (!isOneOf(CONTENT_TYPES, contentType)) return { success: false, error: "Select a content type" };
  if (!postedAt) return { success: false, error: "Posted date is required" };

  const supabase = await createClient();
  const { error } = await supabase.from("posts").insert({
    tenant_slug: tenant.slug,
    title,
    platform,
    content_type: contentType,
    posted_at: postedAt,
    reach: num(formData, "reach"),
    impressions: num(formData, "impressions"),
    likes: num(formData, "likes"),
    comments: num(formData, "comments"),
    shares: num(formData, "shares"),
    saves: num(formData, "saves"),
    post_url: postUrl,
    notes,
    created_by: user.id,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/post-history");
  return { success: true };
}

export async function deletePost(postId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/post-history");
  return { success: true };
}
