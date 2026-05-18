"use server";

// Server action for the blog-writer "Preview on Gruve" pane
// (PULSE-SEO-SPEC.md §13). Mints a token server-side (secret never
// reaches the client) and returns the Gruve preview URL.

import { createClient } from "@/lib/supabase/server";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import {
  mintPreviewToken,
  isPreviewConfigured,
} from "@/lib/seo/preview-token";

export type SeoPreviewResult =
  | { success: true; url: string; expiresInSeconds: number }
  | { success: false; error: string };

export async function getSeoPreviewUrl(
  postId: string
): Promise<SeoPreviewResult> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };
  if (!isPreviewConfigured()) {
    return {
      success: false,
      error: "Preview is not configured yet (PREVIEW_SHARED_SECRET missing).",
    };
  }

  const supabase = await createClient();
  const { data: post, error } = await supabase
    .from("blog_posts")
    .select("id, tenant_slug, slug")
    .eq("id", postId)
    .maybeSingle();

  if (error || !post) return { success: false, error: "Post not found" };
  if (post.tenant_slug !== tenant.slug) {
    return { success: false, error: "Wrong tenant" };
  }
  if (!post.slug) {
    return {
      success: false,
      error: "Set a URL slug before previewing.",
    };
  }

  try {
    const minted = await mintPreviewToken({
      slug: post.slug,
      contentType: "blog",
    });
    return {
      success: true,
      url: minted.url,
      expiresInSeconds: minted.expiresInSeconds,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Could not mint preview token",
    };
  }
}
