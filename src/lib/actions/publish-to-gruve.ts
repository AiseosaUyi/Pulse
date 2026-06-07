"use server";

// "Push to Gruve" — the direct publish path from the blog editor. Validates
// that every field Contentful's gruveBlog REQUIRES is present, converts the
// markdown body to Contentful RichText, then runs the publish state machine
// (upsert + publish). Because Gruve's gamma + www both read the same Contentful
// `master` space, a successful publish lands on BOTH gamma.gruve.events
// (confirm) and www.gruve.events (live) at once.

import { revalidatePath } from "next/cache";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPublish } from "@/lib/seo/publish-runner";
import { markdownToRichText, isRichTextDocument } from "@/lib/seo/markdown-to-richtext";
import { isContentfulConfigured } from "@/lib/integrations/contentful";

export interface PublishReadiness {
  ready: boolean;
  missing: string[];
}

const REQUIRED_LABELS: Record<string, string> = {
  title: "Title",
  slug: "URL slug",
  content: "Body content",
  question: "Question / hook",
  cover_image: "Banner image",
  thumbnail: "Thumbnail image",
  author: "Author name",
  author_image: "Author image",
};

type PostRow = {
  tenant_slug: string;
  title: string | null;
  slug: string | null;
  content: string | null;
  question: string | null;
  author: string | null;
  author_image: string | null;
  cover_image: { url?: string } | null;
  thumbnail: { url?: string } | null;
};

function missingFields(p: PostRow): string[] {
  const missing: string[] = [];
  if (!p.title?.trim()) missing.push(REQUIRED_LABELS.title);
  if (!p.slug?.trim()) missing.push(REQUIRED_LABELS.slug);
  if (!p.content?.trim()) missing.push(REQUIRED_LABELS.content);
  if (!p.question?.trim()) missing.push(REQUIRED_LABELS.question);
  if (!p.cover_image?.url) missing.push(REQUIRED_LABELS.cover_image);
  if (!p.thumbnail?.url) missing.push(REQUIRED_LABELS.thumbnail);
  if (!p.author?.trim()) missing.push(REQUIRED_LABELS.author);
  if (!p.author_image) missing.push(REQUIRED_LABELS.author_image);
  return missing;
}

export type PublishResult =
  | { success: true; gammaUrl: string; liveUrl: string }
  | { success: false; error: string; missing?: string[] };

export async function publishBlogToGruve(
  postId: string
): Promise<PublishResult> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };

  if (!isContentfulConfigured()) {
    return {
      success: false,
      error:
        "Contentful isn't configured yet (CONTENTFUL_CMA_TOKEN missing). Publishing is unavailable until the token is set.",
    };
  }

  const supabase = await createClient();
  const { data: post, error } = await supabase
    .from("blog_posts")
    .select(
      "tenant_slug, title, slug, content, question, author, author_image, cover_image, thumbnail, body_rich_text"
    )
    .eq("id", postId)
    .maybeSingle();

  if (error || !post) return { success: false, error: "Post not found" };
  if (post.tenant_slug !== tenant.slug)
    return { success: false, error: "Wrong tenant" };

  const missing = missingFields(post as PostRow);
  if (missing.length > 0) {
    return {
      success: false,
      error: `Add the following before publishing: ${missing.join(", ")}.`,
      missing,
    };
  }

  // Convert markdown → Contentful RichText (the previously-unwired step) and
  // move the post into 'publishing' so the runner proceeds. Admin client: this
  // is an explicit, validated user action that intentionally bypasses the
  // review/approval chain ("push straight to Gruve").
  const admin = createAdminClient();
  const bodyRichText = isRichTextDocument(post.body_rich_text)
    ? post.body_rich_text
    : await markdownToRichText(post.content ?? "");

  const { error: upErr } = await admin
    .from("blog_posts")
    .update({ body_rich_text: bodyRichText, status: "publishing" })
    .eq("id", postId);
  if (upErr) return { success: false, error: `Could not stage publish: ${upErr.message}` };

  const outcome = await runPublish({ blogPostId: postId });
  if (outcome.status !== "succeeded") {
    return {
      success: false,
      error: `Publish failed at "${outcome.failedStep ?? "?"}": ${outcome.error ?? "unknown error"}`,
    };
  }

  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath(`/seo-tracker/blog-writer/${postId}`);
  return {
    success: true,
    gammaUrl: `https://gamma.gruve.events/blogs/${post.slug}`,
    liveUrl: `https://www.gruve.events/blogs/${post.slug}`,
  };
}
