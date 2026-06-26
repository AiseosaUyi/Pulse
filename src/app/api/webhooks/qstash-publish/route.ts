// QStash publish webhook — dispatches scheduled posts to the right publisher.
// YouTube → direct OAuth (free). Instagram/LinkedIn/TikTok → SocialAPI.ai.
// ALL DB reads/writes use createAdminClient() — auth.uid() is null in QStash.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyQStashSignature } from "@/lib/qstash";
import { publishPost } from "@/lib/integrations/socialapi";
import { getSocialAccountId } from "@/lib/services/social-accounts";
import { publishToYouTube } from "@/lib/publishers/youtube";

interface QStashPayload {
  scheduledPostId: string;
  tenantSlug: string;
  platform: string;
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const sig = req.headers.get("upstash-signature") ?? "";
  const valid = await verifyQStashSignature(body, sig);
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const payload = JSON.parse(body) as QStashPayload;
  const { scheduledPostId, tenantSlug, platform } = payload;
  const admin = createAdminClient();

  const { data: post } = await admin
    .from("scheduled_posts")
    .select("*")
    .eq("id", scheduledPostId)
    .single();

  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  // Allow retry if stuck in 'publishing' with no posted_at (mid-flight crash).
  // Skip if already published or explicitly failed.
  if (post.status === "published" || post.status === "failed") return NextResponse.json({ ok: true });
  if (post.status !== "scheduled" && !(post.status === "publishing" && !post.posted_at)) {
    return NextResponse.json({ ok: true });
  }

  await admin
    .from("scheduled_posts")
    .update({ status: "publishing" })
    .eq("id", scheduledPostId);

  try {
    let postId: string;
    let postUrl: string | null = null;

    if (platform === "youtube") {
      // Direct YouTube OAuth — free, no third party
      ({ postId, postUrl } = await publishToYouTube(tenantSlug, post.content));
    } else {
      // SocialAPI.ai — covers Instagram, LinkedIn, TikTok
      const accountId = await getSocialAccountId(tenantSlug, platform);
      if (!accountId) throw new Error(`No ${platform} account linked for ${tenantSlug}`);

      const result = await publishPost({ accountIds: [accountId], text: post.content });
      const target = result.targets?.[0];
      postId = target?.post_id ?? result.id;
      postUrl = target?.url ?? null;
      // Store the SocialAPI post ID separately so the metrics cron can call /posts/{id}/metrics
      await admin.from("scheduled_posts").update({ source_api_post_id: result.id }).eq("id", scheduledPostId);
    }

    await admin
      .from("scheduled_posts")
      .update({
        status: "published",
        posted_at: new Date().toISOString(),
        platform_post_id: postId,
        platform_post_url: postUrl,
      })
      .eq("id", scheduledPostId);

    return NextResponse.json({ ok: true, postId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[qstash-publish] failed", { scheduledPostId, tenantSlug, platform, msg });
    await admin
      .from("scheduled_posts")
      .update({ status: "failed", error_message: msg })
      .eq("id", scheduledPostId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
