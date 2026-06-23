// Instagram two-step publish webhook.
// Step 1 (in qstash-publish) creates the container.
// Step 2 here polls status and publishes once FINISHED, or re-enqueues to poll again.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyQStashSignature, enqueueNow } from "@/lib/qstash";
import {
  pollInstagramContainer,
  publishInstagramContainer,
} from "@/lib/integrations/platforms/instagram";
import { getPlatformConnection } from "@/lib/services/platform-connections";
import { appUrl } from "@/lib/integrations/platform-oauth";

interface IgPollPayload {
  scheduledPostId: string;
  tenantSlug: string;
  creationId: string;
  igUserId: string;
  attempts: number;
}

const MAX_POLL_ATTEMPTS = 10; // 10 × 30s = 5 min ceiling

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const sig = req.headers.get("upstash-signature") ?? "";
  const valid = await verifyQStashSignature(body, sig);
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const payload = JSON.parse(body) as IgPollPayload;
  const { scheduledPostId, tenantSlug, creationId, igUserId, attempts } = payload;
  const admin = createAdminClient();

  const conn = await getPlatformConnection(tenantSlug, "instagram");
  if (!conn) {
    await admin
      .from("scheduled_posts")
      .update({ status: "failed", error_message: "Instagram disconnected" })
      .eq("id", scheduledPostId);
    return NextResponse.json({ error: "No connection" }, { status: 400 });
  }

  const statusCode = await pollInstagramContainer(conn.accessToken, igUserId, creationId);

  if (statusCode === "FINISHED") {
    try {
      const { postId, postUrl } = await publishInstagramContainer(
        conn.accessToken,
        igUserId,
        creationId
      );

      const { data: post } = await admin
        .from("scheduled_posts")
        .select("content")
        .eq("id", scheduledPostId)
        .single();

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
        platform: "instagram",
        content: post?.content ?? "",
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
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (statusCode === "ERROR" || statusCode === "EXPIRED") {
    await admin
      .from("scheduled_posts")
      .update({ status: "failed", error_message: `IG container ${statusCode}` })
      .eq("id", scheduledPostId);
    return NextResponse.json({ error: statusCode }, { status: 400 });
  }

  // Still IN_PROGRESS — re-enqueue with 30s delay if under attempt ceiling
  if (attempts >= MAX_POLL_ATTEMPTS) {
    await admin
      .from("scheduled_posts")
      .update({ status: "failed", error_message: "IG container timed out after max polls" })
      .eq("id", scheduledPostId);
    return NextResponse.json({ error: "max_attempts" }, { status: 400 });
  }

  await enqueueNow(appUrl("/api/webhooks/qstash-ig-publish"), {
    scheduledPostId,
    tenantSlug,
    creationId,
    igUserId,
    attempts: attempts + 1,
  });

  return NextResponse.json({ ok: true, step: "poll-requeued", attempts: attempts + 1 });
}
