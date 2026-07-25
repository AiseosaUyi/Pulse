import { createClient } from "@/lib/supabase/server";

// Which publish target(s) (staging/live) a post has an actual SUCCEEDED
// seo_publish_runs row for (migration 044 + 070's target column).
//
// blog_posts.status alone can't answer this: publish-runner's
// mark_published step (src/lib/seo/publish-runner.ts ~L470-487) flips
// status to "published" identically for target: "test" and target: "live"
// — it never branches on target. Since the editor UI defaults
// publishTarget to "test" so a normal click never accidentally goes live
// (blog-writer/[id]/client.tsx), most published posts have only ever
// succeeded on staging. seo_publish_runs is the only place that actually
// records which target(s) succeeded, one row per attempt.

export interface SucceededPublishTargets {
  /** A seo_publish_runs row with status='succeeded' target='live' exists. */
  live: boolean;
  /** A seo_publish_runs row with status='succeeded' target='test' exists. */
  test: boolean;
}

const NONE: SucceededPublishTargets = { live: false, test: false };

/** Single-post lookup — used by the blog editor page. */
export async function getSucceededPublishTargets(
  tenantSlug: string,
  blogPostId: string
): Promise<SucceededPublishTargets> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seo_publish_runs")
    .select("target")
    .eq("tenant_slug", tenantSlug)
    .eq("blog_post_id", blogPostId)
    .eq("status", "succeeded");
  if (error || !data) return NONE;
  return {
    live: data.some((r) => r.target === "live"),
    test: data.some((r) => r.target === "test"),
  };
}

/**
 * Bulk lookup for the post list — one query for every post in the tenant
 * instead of N+1 per card. Keyed by blog_post_id; posts with no succeeded
 * run are simply absent (callers should default to { live: false, test:
 * false } on a miss).
 */
export async function getSucceededPublishTargetsForTenant(
  tenantSlug: string
): Promise<Record<string, SucceededPublishTargets>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seo_publish_runs")
    .select("blog_post_id, target")
    .eq("tenant_slug", tenantSlug)
    .eq("status", "succeeded");
  if (error || !data) return {};

  const map: Record<string, SucceededPublishTargets> = {};
  for (const row of data) {
    const entry = map[row.blog_post_id] ?? { live: false, test: false };
    if (row.target === "live") entry.live = true;
    if (row.target === "test") entry.test = true;
    map[row.blog_post_id] = entry;
  }
  return map;
}
