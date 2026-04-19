"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getBlogPostRecord } from "@/lib/services/blog-posts";
import { getIntegrationSecrets } from "@/lib/services/integrations";
import { publishToWordpress } from "@/lib/integrations/wordpress";
import { publishToGhost } from "@/lib/integrations/ghost";
import { postToAyrshare, type AyrsharePlatform } from "@/lib/integrations/ayrshare";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

/**
 * Publish a blog post to WordPress or Ghost. Rendering Tiptap JSON
 * to HTML would be ideal; for now we push the markdown content
 * wrapped in <p> tags since both platforms accept HTML blocks.
 */
export async function publishBlog(
  tenantSlug: string,
  blogPostId: string,
  provider: "wordpress" | "ghost",
  options: { status?: "draft" | "publish" | "published" } = {}
): Promise<ActionResult<{ externalUrl: string | null; externalId: string | null }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const post = await getBlogPostRecord(tenantSlug, blogPostId);
  if (!post) return { success: false, error: "Blog post not found" };

  const creds = await getIntegrationSecrets(tenantSlug, provider);
  if (!creds) {
    return { success: false, error: `${provider} integration not configured` };
  }

  const html = markdownToHtml(post.content);
  let externalId: string | null = null;
  let externalUrl: string | null = null;
  let errorMessage: string | null = null;
  let status: "published" | "draft_pushed" | "failed" = "failed";

  if (provider === "wordpress") {
    const siteUrl = String(creds.config.site_url ?? "");
    const username = String(creds.config.username ?? "");
    if (!siteUrl || !username || !creds.secretToken) {
      return { success: false, error: "WordPress credentials incomplete" };
    }
    const wpStatus = options.status === "publish" ? "publish" : "draft";
    const res = await publishToWordpress(
      { siteUrl, username, appPassword: creds.secretToken },
      {
        title: post.title,
        content: html,
        status: wpStatus,
        slug: post.slug ?? undefined,
        excerpt: post.metaDescription ?? undefined,
        categories: Array.isArray(creds.config.default_categories)
          ? (creds.config.default_categories as string[])
          : undefined,
      }
    );
    if (res.ok) {
      externalId = res.id != null ? String(res.id) : null;
      externalUrl = res.url ?? null;
      status = wpStatus === "publish" ? "published" : "draft_pushed";
    } else {
      errorMessage = res.error ?? "WordPress publish failed";
    }
  } else {
    const adminUrl = String(creds.config.admin_url ?? "");
    if (!adminUrl || !creds.secretToken || !creds.secretToken2) {
      return { success: false, error: "Ghost credentials incomplete" };
    }
    const ghostStatus = options.status === "published" ? "published" : "draft";
    const res = await publishToGhost(
      {
        adminUrl,
        adminKey: `${creds.secretToken}:${creds.secretToken2}`,
      },
      {
        title: post.title,
        html,
        status: ghostStatus,
        slug: post.slug ?? undefined,
        excerpt: post.metaDescription ?? undefined,
      }
    );
    if (res.ok) {
      externalId = res.id ?? null;
      externalUrl = res.url ?? null;
      status = ghostStatus === "published" ? "published" : "draft_pushed";
    } else {
      errorMessage = res.error ?? "Ghost publish failed";
    }
  }

  const supabase = await createClient();
  await supabase.from("blog_publications").insert({
    tenant_slug: tenantSlug,
    blog_post_id: blogPostId,
    provider,
    external_id: externalId,
    external_url: externalUrl,
    status,
    error: errorMessage,
    created_by: user.id,
  });

  if (errorMessage) {
    return { success: false, error: errorMessage };
  }

  // Auto-advance the blog post status to match what we just pushed.
  if (status === "published") {
    await supabase
      .from("blog_posts")
      .update({ status: "published" })
      .eq("tenant_slug", tenantSlug)
      .eq("id", blogPostId);
  }

  revalidatePath(`/seo-tracker/blog-writer/${blogPostId}`);
  revalidatePath("/seo-tracker/blog-writer");
  return { success: true, externalUrl, externalId };
}

/**
 * Publish a scheduled post to social networks via Ayrshare. Marks
 * the scheduled_posts row as `posted` and writes per-platform
 * telemetry to scheduled_post_publications.
 */
export async function publishScheduledPost(
  tenantSlug: string,
  scheduledPostId: string,
  platforms: AyrsharePlatform[]
): Promise<ActionResult<{ results: Array<{ platform: string; ok: boolean; url?: string | null; error?: string | null }> }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  if (platforms.length === 0) {
    return { success: false, error: "Choose at least one platform" };
  }

  const supabase = await createClient();
  const { data: scheduled, error: loadError } = await supabase
    .from("scheduled_posts")
    .select("id, caption, platform, tenant_slug")
    .eq("tenant_slug", tenantSlug)
    .eq("id", scheduledPostId)
    .maybeSingle();
  if (loadError || !scheduled) {
    return { success: false, error: "Scheduled post not found" };
  }
  if (!scheduled.caption) {
    return { success: false, error: "Scheduled post has no caption to publish" };
  }

  const creds = await getIntegrationSecrets(tenantSlug, "ayrshare");
  if (!creds?.secretToken) {
    return { success: false, error: "Ayrshare integration not configured" };
  }

  const result = await postToAyrshare(creds.secretToken, {
    post: scheduled.caption,
    platforms,
  });

  const perPlatformRows = (result.postIds ?? platforms.map((p) => ({ platform: p }))).map(
    (entry) => ({
      tenant_slug: tenantSlug,
      scheduled_post_id: scheduledPostId,
      provider: "ayrshare" as const,
      platform: entry.platform,
      external_id: "id" in entry ? entry.id ?? null : null,
      external_url: "postUrl" in entry ? entry.postUrl ?? null : null,
      status: "error" in entry && entry.error
        ? ("failed" as const)
        : result.ok
          ? ("published" as const)
          : ("failed" as const),
      error: "error" in entry ? entry.error ?? null : result.ok ? null : result.error ?? null,
      created_by: user.id,
    })
  );

  if (perPlatformRows.length > 0) {
    await supabase.from("scheduled_post_publications").insert(perPlatformRows);
  }

  if (result.ok) {
    await supabase
      .from("scheduled_posts")
      .update({ status: "posted" })
      .eq("tenant_slug", tenantSlug)
      .eq("id", scheduledPostId);
  }

  revalidatePath("/post-history");
  revalidatePath("/engagement");

  return {
    success: result.ok,
    results: perPlatformRows.map((r) => ({
      platform: r.platform,
      ok: r.status === "published",
      url: r.external_url,
      error: r.error,
    })),
    ...(result.ok ? {} : { error: result.error ?? "Publish failed" }),
  } as ActionResult<{ results: Array<{ platform: string; ok: boolean; url?: string | null; error?: string | null }> }>;
}

/**
 * Minimal markdown → HTML shim. Both WordPress and Ghost accept raw
 * HTML; a real markdown parser is overkill here because blog posts
 * are already mostly plain paragraphs. Handles:
 * - blank-line paragraph breaks
 * - `## heading` / `### heading`
 * - `- list` / `* list` items
 * - `[link text](url)` inline
 * - `**bold**`
 */
function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let listOpen = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1].length, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = /^[-*]\s+(.+)$/.exec(line);
    if (listItem) {
      flushParagraph();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`  <li>${inline(listItem[1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return out.join("\n");
}

function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
