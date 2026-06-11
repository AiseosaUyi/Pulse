"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveActiveConnection } from "@/lib/composio/resolve-alias";
import {
  publishInstagramSinglePost,
  publishLinkedInTextPost,
  publishTikTokVideo,
  getInstagramRecentMedia,
} from "@/lib/composio/executors";
import { applyTrackingLinks } from "@/lib/attribution/links";
import type { ScheduledPostStatus } from "@/lib/types/scheduled-posts";
import type { Toolkit } from "@/lib/composio/client";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

interface ScheduleInput {
  briefId?: string | null;
  platform: string;
  contentType?: string | null;
  caption?: string | null;
  bestTime?: string | null;
  scheduledFor: string;
  status?: ScheduledPostStatus;
  notes?: string | null;
}

export async function scheduleBriefPost(
  tenantSlug: string,
  input: ScheduleInput
): Promise<ActionResult<{ id: string }>> {
  if (!input.platform || !input.scheduledFor) {
    return { success: false, error: "Platform and date are required" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert({
      tenant_slug: tenantSlug,
      brief_id: input.briefId ?? null,
      platform: input.platform,
      content_type: input.contentType ?? null,
      caption: input.caption ?? null,
      best_time: input.bestTime ?? null,
      scheduled_for: input.scheduledFor,
      status: input.status ?? "scheduled",
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };
  revalidatePath("/ai-content");
  return { success: true, id: data.id };
}

export async function updateScheduledPostStatus(
  tenantSlug: string,
  id: string,
  status: ScheduledPostStatus
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("scheduled_posts")
    .update({ status })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/ai-content");
  return { success: true };
}

// Publishes a scheduled post via Composio when an active connection
// exists for the post's platform. Records the result in
// scheduled_post_publications and creates a `posts` row tied via
// scheduled_posts.posted_post_id.
//
// When no Composio connection is active for the platform we return
// a `success: false` result with `reason: 'not_connected'` so the UI
// can prompt the user to connect (Ayrshare fallback can branch in
// here later when its publish executor is wired).
interface PublishInput {
  tenantSlug: string;
  scheduledPostId: string;
  // Optional media URL for IG/TikTok publishes. LinkedIn ignored unless
  // it's an article-style share (separate flow).
  mediaUrl?: string;
}

export async function publishScheduledPost(
  input: PublishInput
): Promise<
  | { success: true; postId: string; externalId: string }
  | { success: false; error: string; reason?: "not_connected" }
> {
  const supabase = await createClient();
  const { data: sp, error: spErr } = await supabase
    .from("scheduled_posts")
    .select("id, platform, caption, content_type, scheduled_for, brief_id")
    .eq("id", input.scheduledPostId)
    .eq("tenant_slug", input.tenantSlug)
    .single();

  if (spErr || !sp) {
    return { success: false, error: spErr?.message ?? "Post not found" };
  }

  const platform = sp.platform.toLowerCase() as Toolkit;
  if (!["instagram", "tiktok", "linkedin"].includes(platform)) {
    return {
      success: false,
      error: `Composio publish is not supported for ${platform}`,
    };
  }

  const conn = await resolveActiveConnection(input.tenantSlug, platform);
  if (!conn) {
    return {
      success: false,
      error: `No active ${platform} connection for this workspace`,
      reason: "not_connected",
    };
  }

  // Attribution: tag any link in the caption with UTMs + a /r/:code short link
  // so a click (and any downstream order) traces back to this post/campaign.
  const utm = {
    utm_source: platform,
    utm_medium: sp.content_type ?? "social",
    utm_campaign: sp.brief_id ?? input.scheduledPostId,
    utm_content: input.scheduledPostId,
  };
  const caption = await applyTrackingLinks(sp.caption, {
    tenantSlug: input.tenantSlug,
    scheduledPostId: input.scheduledPostId,
    ...utm,
  });

  let externalId = "";
  let postUrl: string | null = null;
  try {
    if (platform === "instagram") {
      if (!input.mediaUrl) {
        return { success: false, error: "Instagram publish requires mediaUrl" };
      }
      const ct = sp.content_type ?? "image";
      const mediaType =
        ct === "video" ? "video" : ct === "carousel" ? "image" : "image";
      const out = await publishInstagramSinglePost(conn, {
        mediaUrl: input.mediaUrl,
        caption: caption || undefined,
        mediaType,
      });
      externalId = out.mediaId;
      // Best-effort: resolve the live permalink so post_url is provable.
      try {
        const media = await getInstagramRecentMedia(conn, 25);
        postUrl = media.find((m) => m.id === externalId)?.permalink ?? null;
      } catch {
        // permalink lookup is non-critical
      }
    } else if (platform === "linkedin") {
      const out = await publishLinkedInTextPost(conn, caption);
      externalId = out.postUrn;
    } else {
      // tiktok
      if (!input.mediaUrl) {
        return { success: false, error: "TikTok publish requires mediaUrl" };
      }
      const out = await publishTikTokVideo(conn, {
        videoUrl: input.mediaUrl,
        caption: caption || undefined,
      });
      externalId = out.publishId;
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Publish failed",
    };
  }

  // Insert posts row first so we can link from scheduled_posts.posted_post_id.
  // Use admin client because RLS forbids inserts during server actions
  // when the user is a member but not the row's creator until commit.
  const admin = createAdminClient();
  const { data: post, error: postErr } = await admin
    .from("posts")
    .insert({
      tenant_slug: input.tenantSlug,
      title: (sp.caption ?? "").slice(0, 120) || "Untitled",
      platform,
      content_type: sp.content_type ?? "text",
      posted_at: new Date().toISOString().slice(0, 10),
      external_id: externalId,
      post_url: postUrl,
      ...utm,
    })
    .select("id")
    .single();

  if (postErr || !post) {
    return { success: false, error: postErr?.message ?? "Posts insert failed" };
  }

  // Backfill the tracking links created above with the now-known post id.
  await admin
    .from("links")
    .update({ post_id: post.id })
    .eq("scheduled_post_id", input.scheduledPostId)
    .is("post_id", null);

  await admin
    .from("scheduled_post_publications")
    .insert({
      tenant_slug: input.tenantSlug,
      scheduled_post_id: input.scheduledPostId,
      provider: "composio",
      platform,
      external_id: externalId,
      status: "published",
    });

  await admin
    .from("scheduled_posts")
    .update({ status: "posted", posted_post_id: post.id })
    .eq("id", input.scheduledPostId);

  revalidatePath("/ai-content");
  revalidatePath("/post-history");
  return { success: true, postId: post.id, externalId };
}

export async function deleteScheduledPost(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("scheduled_posts")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/ai-content");
  return { success: true };
}
