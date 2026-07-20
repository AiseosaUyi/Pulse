"use server";

// "Push to <tenant site>" — the direct publish path from the blog editor.
// Validates that every field the blog content type REQUIRES is present,
// converts the markdown body to Contentful RichText, then runs the publish
// state machine (upsert + publish). The live URL is built from the tenant's
// configured domain (multi-tenant: Gruve, Sippy, …).

import { revalidatePath } from "next/cache";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPublish } from "@/lib/seo/publish-runner";
import { markdownToRichText } from "@/lib/seo/markdown-to-richtext";
import { resolveContentfulConfig, type PublishTarget } from "@/lib/integrations/contentful";
import { getTenantSeoConfig } from "@/lib/seo/tenant-seo-config";

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

// Contentful's gruveBlog.question field enforces a 12-30 char length (a
// content-model constraint, not documented anywhere in this codebase before
// now — a too-long question 422s at publish time with a raw Contentful
// validation dump instead of a readable message). Catch it here so the
// failure is legible before we ever call the API.
const QUESTION_MIN = 12;
const QUESTION_MAX = 30;

function questionLengthError(question: string | null): string | null {
  const len = question?.trim().length ?? 0;
  if (len === 0) return null; // already covered by missingFields
  if (len < QUESTION_MIN || len > QUESTION_MAX) {
    return `Question / hook must be ${QUESTION_MIN}-${QUESTION_MAX} characters (currently ${len}). Shorten it before publishing.`;
  }
  return null;
}

export type PublishResult =
  | { success: true; gammaUrl: string; liveUrl: string }
  | { success: false; error: string; missing?: string[] };

export async function publishBlogToGruve(
  postId: string,
  target: PublishTarget = "live"
): Promise<PublishResult> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };

  const cfg = await resolveContentfulConfig(tenant.slug, target);
  if (!cfg) {
    return {
      success: false,
      error:
        "Contentful isn't configured for this workspace. Connect a Contentful integration (or set the env credentials) before publishing.",
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

  const questionError = questionLengthError(post.question);
  if (questionError) {
    return { success: false, error: questionError };
  }

  // Convert markdown → Contentful RichText and move the post into
  // 'publishing' so the runner proceeds. Admin client: this is an explicit,
  // validated user action that intentionally bypasses the review/approval
  // chain ("push straight to Gruve").
  //
  // Always regenerate from the current `content` — never reuse a
  // previously-cached body_rich_text. Otherwise every edit made after the
  // first publish (a fixed typo, an added link) is silently dropped because
  // the stale cached RichText document keeps winning. This mirrors the
  // upload_cover step in publish-runner.ts, which already re-uploads
  // cover/thumbnail/author images fresh on every publish.
  const admin = createAdminClient();
  const bodyRichText = await markdownToRichText(post.content ?? "", cfg, post.title ?? undefined);

  const { error: upErr } = await admin
    .from("blog_posts")
    .update({ body_rich_text: bodyRichText, status: "publishing" })
    .eq("id", postId);
  if (upErr) return { success: false, error: `Could not stage publish: ${upErr.message}` };

  const outcome = await runPublish({ blogPostId: postId, target });
  if (outcome.status !== "succeeded") {
    return {
      success: false,
      error: `Publish failed at "${outcome.failedStep ?? "?"}": ${outcome.error ?? "unknown error"}`,
    };
  }

  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath(`/seo-tracker/blog-writer/${postId}`);
  // Build both view links from real hosts (no hardcoded tenant domain):
  //  - liveUrl  → the tenant's production site (www), from tenant settings
  //  - gammaUrl → the staging site, from GRUVE_STAGING_BASE_URL when set
  // The returned link the user clicks matches the target they published to.
  const seo = await getTenantSeoConfig(tenant.slug);
  const path = `${seo.blogPathPrefix}/${post.slug}`;
  const liveUrl = seo.siteBaseUrl ? `${seo.siteBaseUrl}${path}` : path;
  const gammaUrl = seo.stagingBaseUrl ? `${seo.stagingBaseUrl}${path}` : liveUrl;
  return {
    success: true,
    gammaUrl,
    liveUrl,
  };
}
