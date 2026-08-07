"use server";

// Server actions for the manual blog-authoring "section builder"
// (src/app/(app)/(intelligence)/seo-tracker/blog-writer/[id]/sections).
// Sections live in blog_posts.draft_sections (scratch state) until
// compileDraftSections() folds them into the normal content/content_json
// blob every other part of the app already reads.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getBlogPostRecord } from "@/lib/services/blog-posts";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import {
  generateBlogSection,
  generateFaqItems,
  BlogSectionGenerationError,
} from "@/lib/ai/blog-section";
import { countWords } from "@/lib/blog/word-count";
import { uniqueSlugFor } from "@/lib/blog/slug";
import { buildGooglePreview } from "@/lib/blog/google-preview";
import type { BlogType } from "@/lib/types/blog-ideation";
import type { DraftSection } from "@/lib/types/blog-posts";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

function seedSections(): DraftSection[] {
  return [
    { id: crypto.randomUUID(), kind: "intro", heading: "", content: "" },
    { id: crypto.randomUUID(), kind: "body", heading: "", content: "" },
    { id: crypto.randomUUID(), kind: "conclusion", heading: "", content: "" },
  ];
}

/** Creates a blank post and drops the author straight into the section
 *  builder — no AI call, just a title and (optionally) light context that
 *  later per-section "Generate" calls can use. */
export async function startManualBlogDraft(
  tenantSlug: string,
  input: { title: string; blogType?: BlogType; extraContext?: string }
): Promise<ActionResult<{ postId: string }>> {
  const title = input.title.trim();
  if (!title) {
    return { success: false, error: "Give the post a title to get started." };
  }

  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const slug = await uniqueSlugFor(tenantSlug, title);
  const googlePreview = buildGooglePreview({
    title,
    metaDescription: null,
    slug,
    tenantDomain: tenant.domain,
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .insert({
      tenant_slug: tenantSlug,
      title,
      slug,
      content: "",
      status: "draft",
      word_count: 0,
      draft_sections: seedSections(),
      blog_type: input.blogType ?? null,
      google_preview: googlePreview,
    })
    .select("id")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };

  revalidatePath("/seo-tracker/blog-writer");
  return { success: true, postId: data.id };
}

/** Autosave patch for the section-builder page. */
export async function updateDraftSections(
  tenantSlug: string,
  postId: string,
  patch: { draftSections?: DraftSection[]; faqItems?: Array<{ question: string; answer: string }>; title?: string }
): Promise<ActionResult> {
  const update: Record<string, unknown> = {};
  if (patch.draftSections !== undefined) update.draft_sections = patch.draftSections;
  if (patch.faqItems !== undefined) update.faq_items = patch.faqItems;
  if (patch.title !== undefined && patch.title.trim()) update.title = patch.title.trim();
  if (Object.keys(update).length === 0) return { success: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("blog_posts")
    .update(update)
    .eq("id", postId)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

async function loadDraftContext(tenantSlug: string, postId: string) {
  const post = await getBlogPostRecord(tenantSlug, postId);
  if (!post) return null;
  const sections = post.draftSections ?? [];
  const { voice, positioning } = await getBrandContext(tenantSlug);
  return { post, sections, voice, positioning };
}

/** Generates one section's prose using the title + whatever sibling
 *  sections are already drafted, then patches just that section. */
export async function generateDraftSectionAction(
  tenantSlug: string,
  postId: string,
  sectionId: string
): Promise<ActionResult<{ section: DraftSection }>> {
  const ctx = await loadDraftContext(tenantSlug, postId);
  if (!ctx) return { success: false, error: "Post not found" };
  const { post, sections, voice, positioning } = ctx;

  const target = sections.find((s) => s.id === sectionId);
  if (!target) return { success: false, error: "Section not found" };

  try {
    const { content } = await generateBlogSection({
      tenantSlug,
      title: post.title,
      voice,
      positioning,
      kind: target.kind,
      heading: target.heading,
      siblingSections: sections.filter((s) => s.id !== sectionId),
    });

    const updated: DraftSection = { ...target, content };
    const nextSections = sections.map((s) => (s.id === sectionId ? updated : s));

    const supabase = await createClient();
    const { error } = await supabase
      .from("blog_posts")
      .update({ draft_sections: nextSections })
      .eq("id", postId)
      .eq("tenant_slug", tenantSlug);
    if (error) return { success: false, error: error.message };

    return { success: true, section: updated };
  } catch (err) {
    const msg =
      err instanceof BlogSectionGenerationError
        ? "AI generation failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}

/** Generates a fresh batch of FAQ Q&A pairs from the title + sections
 *  drafted so far, appending to whatever FAQ items already exist. */
export async function generateDraftFaqAction(
  tenantSlug: string,
  postId: string
): Promise<ActionResult<{ faqItems: Array<{ question: string; answer: string }> }>> {
  const ctx = await loadDraftContext(tenantSlug, postId);
  if (!ctx) return { success: false, error: "Post not found" };
  const { post, sections, voice, positioning } = ctx;

  try {
    const { items } = await generateFaqItems({
      tenantSlug,
      title: post.title,
      voice,
      positioning,
      siblingSections: sections,
      existingQuestions: post.faqItems.map((f) => f.question),
    });

    const nextFaq = [...post.faqItems, ...items];
    const supabase = await createClient();
    const { error } = await supabase
      .from("blog_posts")
      .update({ faq_items: nextFaq })
      .eq("id", postId)
      .eq("tenant_slug", tenantSlug);
    if (error) return { success: false, error: error.message };

    return { success: true, faqItems: nextFaq };
  } catch (err) {
    const msg =
      err instanceof BlogSectionGenerationError
        ? "AI generation failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}

/** Joins draft_sections into the single markdown blob every other part of
 *  the app reads, clears draft_sections, and hands off to the normal
 *  editor — after this a manual post is indistinguishable from an
 *  AI-generated one. content_json is deliberately left null: TiptapEditor
 *  already lazy-parses markdown into TipTap JSON on first open (same path
 *  every AI-generated post takes today), so no separate markdown→JSON
 *  conversion is needed here. */
export async function compileDraftSections(
  tenantSlug: string,
  postId: string
): Promise<ActionResult> {
  const post = await getBlogPostRecord(tenantSlug, postId);
  if (!post) return { success: false, error: "Post not found" };
  const sections = post.draftSections ?? [];

  const body = sections
    .map((s) => {
      const text = s.content.trim();
      if (!text) return null;
      if (s.kind === "body" && s.heading.trim()) {
        return `## ${s.heading.trim()}\n\n${text}`;
      }
      return text;
    })
    .filter((s): s is string => s !== null)
    .join("\n\n");

  const content = `# ${post.title}\n\n${body}`.trim();
  if (!body) {
    return {
      success: false,
      error: "Write or generate at least one section before compiling.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("blog_posts")
    .update({
      content,
      content_json: null,
      word_count: countWords(content),
      draft_sections: null,
    })
    .eq("id", postId)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath(`/seo-tracker/blog-writer/${postId}`);
  return { success: true };
}
