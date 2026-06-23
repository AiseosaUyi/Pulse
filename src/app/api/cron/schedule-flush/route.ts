// Daily cron: re-enqueue scheduled posts that are within the next 7 days
// but have no qstash_message_id (e.g. posts scheduled >7 days out that just entered the window).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueAt, isQStashConfigured, QSTASH_MAX_DELAY_DAYS } from "@/lib/qstash";
import { appUrl } from "@/lib/integrations/platform-oauth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isQStashConfigured()) {
    return NextResponse.json({ ok: true, skipped: "QStash not configured" });
  }

  const admin = createAdminClient();
  const windowEnd = new Date(Date.now() + QSTASH_MAX_DELAY_DAYS * 24 * 60 * 60 * 1000);

  const { data: posts } = await admin
    .from("scheduled_posts")
    .select("id, tenant_slug, platform, scheduled_for")
    .eq("status", "scheduled")
    .is("qstash_message_id", null)
    .lte("scheduled_for", windowEnd.toISOString())
    .gte("scheduled_for", new Date().toISOString());

  if (!posts?.length) return NextResponse.json({ ok: true, enqueued: 0 });

  let enqueued = 0;
  for (const post of posts) {
    try {
      const webhookUrl = appUrl(
        post.platform === "instagram"
          ? "/api/webhooks/qstash-ig-publish"
          : "/api/webhooks/qstash-publish"
      );
      const msgId = await enqueueAt({
        url: webhookUrl,
        body: {
          scheduledPostId: post.id,
          tenantSlug: post.tenant_slug,
          platform: post.platform,
        },
        notBefore: new Date(post.scheduled_for),
      });
      await admin
        .from("scheduled_posts")
        .update({ qstash_message_id: msgId })
        .eq("id", post.id);
      enqueued++;
    } catch {
      // non-fatal — will retry next cron run
    }
  }

  return NextResponse.json({ ok: true, enqueued });
}
