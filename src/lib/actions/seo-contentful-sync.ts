"use server";

// Push a Pulse draft into Contentful as an UNPUBLISHED entry (no
// publishEntry) so Gruve's preview (CPA, sees drafts) can render it
// before go-live. Closes the "draft → preview → live" gap in the joint
// dry-run sequence: the publish-runner only ever upserts+publishes
// atomically; this is the upsert-only half, reusing the exact same
// idempotent mapping (pulseId-keyed).

import { createClient } from "@/lib/supabase/server";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import {
  upsertGruveBlog,
  resolveContentfulConfig,
  type GruveBlogDraft,
} from "@/lib/integrations/contentful";
import { markdownToRichText, isRichTextDocument } from "@/lib/seo/markdown-to-richtext";

export type SyncResult =
  | { success: true; entryId: string; version: number; skipped?: false }
  | { success: true; skipped: true } // Contentful not configured yet
  | { success: false; error: string };

export async function syncBlogDraftToContentful(
  postId: string
): Promise<SyncResult> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };

  // Pre-cutover (no Contentful config for this tenant) → skip silently so the
  // preview pane still works against whatever the tenant already has.
  const cfg = await resolveContentfulConfig(tenant.slug);
  if (!cfg) return { success: true, skipped: true };

  const supabase = await createClient();
  const { data: post, error } = await supabase
    .from("blog_posts")
    .select(
      "id, tenant_slug, slug, title, question, content, excerpt, body_rich_text, author, author_image, read_minutes, seo_meta_title, seo_meta_description, canonical_override, faq_items, json_ld_overrides, pulse_metadata, tags, category, author_bio, author_title, author_url, published_date, updated_date, noindex"
    )
    .eq("id", postId)
    .maybeSingle();

  if (error || !post) return { success: false, error: "Post not found" };
  if (post.tenant_slug !== tenant.slug)
    return { success: false, error: "Wrong tenant" };
  if (!post.slug)
    return { success: false, error: "Set a URL slug before previewing." };

  // Derive RichText from the stored markdown when body_rich_text isn't set yet,
  // so preview (and publish) work straight from the editor without a manual
  // conversion step.
  const bodyRichText = isRichTextDocument(post.body_rich_text)
    ? post.body_rich_text
    : await markdownToRichText((post.content as string) ?? "");

  const draft: GruveBlogDraft = {
    pulseId: post.id,
    title: post.title,
    slug: post.slug,
    question: post.question ?? null,
    excerpt: post.excerpt ?? null,
    bodyRichText,
    author: post.author ?? null,
    readMinutes: post.read_minutes ?? null,
    seoMetaTitle: post.seo_meta_title ?? null,
    seoMetaDescription: post.seo_meta_description ?? null,
    canonicalOverride: post.canonical_override ?? null,
    faqItems: post.faq_items ?? null,
    jsonLdOverrides: post.json_ld_overrides ?? null,
    pulseMetadata: post.pulse_metadata ?? null,
    tags: post.tags ?? null,
    category: post.category ?? null,
    authorBio: post.author_bio ?? null,
    authorTitle: post.author_title ?? null,
    authorUrl: post.author_url ?? null,
    publishedDate: post.published_date ?? null,
    updatedDate: post.updated_date ?? null,
    noindex: post.noindex ?? null,
  };

  try {
    // Assets are uploaded by the publish-runner at full publish; a
    // preview draft syncs text/structure (images optional for preview).
    const res = await upsertGruveBlog(draft, {}, cfg);
    await supabase
      .from("blog_posts")
      .update({
        contentful_entry_id: res.entryId,
        contentful_version: res.version,
      })
      .eq("id", post.id);
    return { success: true, entryId: res.entryId, version: res.version };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Contentful sync failed",
    };
  }
}
