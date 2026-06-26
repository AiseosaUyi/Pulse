// Daily cron: fetches engagement metrics from SocialAPI.ai for posts published
// via Pulse and upserts them into own_post_metrics so Post History and Platform
// Score reflect real engagement without any manual entry.
//
// Requires migration 068 to be applied first (adds source_api_post_id to
// scheduled_posts and scheduled_post_id + 'api' source to own_post_metrics).

import { createAdminClient } from "@/lib/supabase/admin";
import { getPostMetrics, isSocialApiConfigured } from "@/lib/integrations/socialapi";

// scheduled_posts.platform → own_post_metrics.platform
const PLATFORM_MAP: Record<string, string> = {
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  x: "twitter",
  // youtube excluded — own_post_metrics platform constraint doesn't include it
};

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSocialApiConfigured()) {
    return Response.json({ skipped: true, reason: "SOCIAL_API_KEY not set" });
  }

  const admin = createAdminClient();

  // Find published posts with a SocialAPI post ID from the last 30 days.
  // Limit to 50 per run to stay well within function timeout.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: posts, error } = await admin
    .from("scheduled_posts")
    .select("id, tenant_slug, platform, content, posted_at, source_api_post_id")
    .eq("status", "published")
    .not("source_api_post_id", "is", null)
    .gte("posted_at", since)
    .order("posted_at", { ascending: false })
    .limit(50);

  if (error || !posts) {
    return Response.json({ error: error?.message ?? "Query failed" }, { status: 500 });
  }

  let synced = 0;
  let errors = 0;

  for (const post of posts) {
    const mappedPlatform = PLATFORM_MAP[post.platform];
    if (!mappedPlatform) continue; // skip youtube and any unknown platforms

    try {
      const metrics = await getPostMetrics(post.source_api_post_id);
      const target = metrics.targets.find(
        (t) => PLATFORM_MAP[t.platform] === mappedPlatform
      ) ?? metrics.targets[0];

      if (!target) continue;

      const engagementTotal = (target.likes ?? 0) + (target.comments ?? 0) + (target.shares ?? 0) + (target.saves ?? 0);

      await admin.from("own_post_metrics").upsert(
        {
          tenant_slug: post.tenant_slug,
          scheduled_post_id: post.id,
          platform: mappedPlatform,
          caption: post.content?.slice(0, 500) ?? "",
          external_url: target.permalink ?? null,
          captured_at: target.metrics_synced_at ?? post.posted_at ?? new Date().toISOString(),
          source: "api",
          metrics: {
            likes: target.likes ?? 0,
            comments: target.comments ?? 0,
            shares: target.shares ?? 0,
            saves: target.saves ?? 0,
            engagement_total: engagementTotal,
          },
        },
        { onConflict: "scheduled_post_id,platform", ignoreDuplicates: false }
      );

      synced++;
    } catch (err) {
      console.error("[sync-post-metrics] failed for post", post.id, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  return Response.json({ synced, errors, total: posts.length });
}
