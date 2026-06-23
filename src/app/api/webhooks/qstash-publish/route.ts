// QStash publish webhook — dispatches a scheduled post to the platform.
// ALL DB reads/writes use createAdminClient() — auth.uid() is null in QStash.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyQStashSignature, enqueueNow } from "@/lib/qstash";
import { publishToX } from "@/lib/publishers/x";
import { publishToYouTube } from "@/lib/publishers/youtube";
import { publishToLinkedIn } from "@/lib/publishers/linkedin";
import { publishToTikTok } from "@/lib/publishers/tiktok";
import { initInstagramPost } from "@/lib/publishers/instagram";
import { appUrl } from "@/lib/integrations/platform-oauth";
import type { OAuthPlatform } from "@/lib/services/platform-connections";

interface QStashPayload {
  scheduledPostId: string;
  tenantSlug: string;
  platform: OAuthPlatform;
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const sig = req.headers.get("upstash-signature") ?? "";
  const valid = await verifyQStashSignature(body, sig);
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const payload = JSON.parse(body) as QStashPayload;
  const { scheduledPostId, tenantSlug, platform } = payload;
  const admin = createAdminClient();

  // Fetch the post
  const { data: post } = await admin
    .from("scheduled_posts")
    .select("*")
    .eq("id", scheduledPostId)
    .single();

  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (post.status !== "scheduled") {
    // Already published or failed — idempotent OK
    return NextResponse.json({ ok: true });
  }

  // Mark as publishing
  await admin
    .from("scheduled_posts")
    .update({ status: "publishing" })
    .eq("id", scheduledPostId);

  try {
    let postId: string;
    let postUrl: string;

    switch (platform) {
      case "x": {
        ({ postId, postUrl } = await publishToX(tenantSlug, post.content));
        break;
      }
      case "youtube": {
        ({ postId, postUrl } = await publishToYouTube(tenantSlug, post.content));
        break;
      }
      case "linkedin": {
        ({ postId, postUrl } = await publishToLinkedIn(tenantSlug, post.content));
        break;
      }
      case "tiktok": {
        ({ postId, postUrl } = await publishToTikTok(tenantSlug, post.content));
        break;
      }
      case "instagram": {
        // Instagram is a two-step flow — initiate here, poll in qstash-ig-publish
        const { creationId, igUserId } = await initInstagramPost({
          tenantSlug,
          content: post.content,
          scheduledPostId,
        });
        // Enqueue the poll webhook (90s delay)
        await enqueueNow(appUrl("/api/webhooks/qstash-ig-publish"), {
          scheduledPostId,
          tenantSlug,
          creationId,
          igUserId,
          attempts: 0,
        });
        return NextResponse.json({ ok: true, step: "ig-container-created" });
      }
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    // Mark published + write to post_log
    await admin
      .from("scheduled_posts")
      .update({
        status: "published",
        posted_at: new Date().toISOString(),
        platform_post_id: postId,
        platform_post_url: postUrl,
      })
      .eq("id", scheduledPostId);

    await admin.from("post_log").insert({
      tenant_slug: tenantSlug,
      platform,
      content: post.content,
      posted_at: new Date().toISOString(),
      platform_post_id: postId,
      source: "scheduled",
    });

    return NextResponse.json({ ok: true, postId, postUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from("scheduled_posts")
      .update({ status: "failed", error_message: msg })
      .eq("id", scheduledPostId);
    // Return 500 so QStash retries
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
