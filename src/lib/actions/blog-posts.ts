"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { generateBlogPost, BlogGenerationError } from "@/lib/ai/generate-blog-post";
import type { BlogPostStatus } from "@/lib/types/blog-posts";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

function wordCountOf(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function generateBlogPostDraft(
  tenantSlug: string,
  input: {
    targetKeyword: string;
    extraContext?: string;
    targetWordCount?: number;
  }
): Promise<ActionResult<{ postId: string }>> {
  if (!input.targetKeyword.trim()) {
    return { success: false, error: "Target keyword is required" };
  }
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const voice = await getBrandVoice(tenantSlug);

  try {
    const draft = await generateBlogPost({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      targetKeyword: input.targetKeyword.trim(),
      extraContext: input.extraContext?.trim(),
      targetWordCount: input.targetWordCount,
    });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("blog_posts")
      .insert({
        tenant_slug: tenantSlug,
        title: draft.title,
        target_keyword: input.targetKeyword.trim(),
        secondary_keywords: draft.secondary_keywords,
        meta_description: draft.meta_description,
        outline: draft.outline,
        content: draft.content,
        word_count: wordCountOf(draft.content),
        status: "draft",
        generator_model: "openai/gpt-4.1",
      })
      .select("id")
      .single();

    if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };

    revalidatePath("/seo-tracker/blog-writer");
    revalidatePath("/seo-tracker");
    return { success: true, postId: data.id };
  } catch (err) {
    const msg =
      err instanceof BlogGenerationError
        ? "AI generation failed. Please try again."
        : err instanceof Error
        ? err.message
        : "Unknown error";
    return { success: false, error: msg };
  }
}

export async function updateBlogPost(
  id: string,
  tenantSlug: string,
  patch: {
    title?: string;
    metaDescription?: string;
    content?: string;
    secondaryKeywords?: string[];
    status?: BlogPostStatus;
  }
): Promise<ActionResult> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.metaDescription !== undefined) update.meta_description = patch.metaDescription;
  if (patch.content !== undefined) {
    update.content = patch.content;
    update.word_count = wordCountOf(patch.content);
  }
  if (patch.secondaryKeywords !== undefined) update.secondary_keywords = patch.secondaryKeywords;
  if (patch.status !== undefined) update.status = patch.status;
  if (Object.keys(update).length === 0) return { success: true };

  const { error } = await supabase
    .from("blog_posts")
    .update(update)
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath("/seo-tracker");
  return { success: true };
}

export async function deleteBlogPost(
  id: string,
  tenantSlug: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("blog_posts")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath("/seo-tracker");
  return { success: true };
}
