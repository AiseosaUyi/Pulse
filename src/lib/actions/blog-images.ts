"use server";

// Auto-fill a blog's banner + thumbnail from a free Pexels photo matched to the
// post topic — so authoring doesn't bottleneck on a graphic designer. One image
// is re-hosted into the public `blog-assets` bucket and used for BOTH fields;
// each tenant's frontend renders it at its own banner vs thumbnail dimensions
// (Contentful Image API), so a single source covers both.

import { requireUser, getCurrentTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchPexelsImage, isPexelsConfigured } from "@/lib/integrations/pexels";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function autofillBlogImageFromTopic(
  postId: string
): Promise<ActionResult<{ url: string; credit: string }>> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };

  if (!isPexelsConfigured()) {
    return {
      success: false,
      error:
        "Image search isn't configured — set PEXELS_API_KEY to enable auto-fill (free at pexels.com/api).",
    };
  }

  const supabase = await createClient();
  const { data: post, error } = await supabase
    .from("blog_posts")
    .select("id, tenant_slug, title, target_keyword, category")
    .eq("id", postId)
    .maybeSingle();
  if (error || !post) return { success: false, error: "Post not found" };
  if (post.tenant_slug !== tenant.slug)
    return { success: false, error: "Wrong tenant" };

  // Build a topical query: the target keyword (or title) + category for context.
  const base = (post.target_keyword || post.title || "").trim();
  const query = [base, (post.category as string | null) ?? ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!query) {
    return {
      success: false,
      error: "Add a title or target keyword first so we can match an image.",
    };
  }

  const photo = await searchPexelsImage(query, { orientation: "landscape" });
  if (!photo) {
    return {
      success: false,
      error: `No stock image found for "${query}". Try a broader keyword or upload manually.`,
    };
  }

  // Re-host into blog-assets so the asset is durable + tenant-pathed like a
  // manual upload (admin client: server-side fetch + upload, bucket is public).
  try {
    const imgRes = await fetch(photo.url, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) throw new Error(`fetch image ${imgRes.status}`);
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const bytes = new Uint8Array(await imgRes.arrayBuffer());

    const admin = createAdminClient();
    const path = `${tenant.slug}/${postId}/auto-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from("blog-assets")
      .upload(path, bytes, { upsert: true, cacheControl: "3600", contentType });
    if (upErr) throw new Error(upErr.message);

    const { data } = admin.storage.from("blog-assets").getPublicUrl(path);
    return {
      success: true,
      url: data.publicUrl,
      credit: `Photo by ${photo.photographer} on Pexels`,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Could not save the image",
    };
  }
}
