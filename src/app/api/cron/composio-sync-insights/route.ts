// Hourly insights enrichment. For every Composio-published post in the
// last 30 days, fetch the platform-native insights and update the
// corresponding `posts` row (reach/impressions/likes/comments/shares/saves).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { listActiveConnections } from "@/lib/composio/resolve-alias";
import {
  getInstagramMediaInsights,
  getLinkedInShareStats,
  listTikTokVideos,
} from "@/lib/composio/executors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOOKBACK_DAYS = 30;

interface PublicationRow {
  external_id: string | null;
  posted_at: string;
  scheduled_post: { posted_post_id: string | null } | null;
}

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();
  const summary = {
    postsUpdated: 0,
    failed: 0,
    errors: [] as { tenant: string; toolkit: string; message: string }[],
  };

  const sinceIso = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // ── Instagram ──────────────────────────────────────────────────
  for (const conn of await listActiveConnections("instagram")) {
    try {
      const { data: pubs } = await admin
        .from("scheduled_post_publications")
        .select(
          "external_id, posted_at, scheduled_post:scheduled_posts(posted_post_id)"
        )
        .eq("tenant_slug", conn.tenantSlug)
        .eq("provider", "composio")
        .eq("platform", "instagram")
        .eq("status", "published")
        .gte("posted_at", sinceIso);

      for (const pub of (pubs ?? []) as unknown as PublicationRow[]) {
        const postedPostId = pub.scheduled_post?.posted_post_id;
        if (!pub.external_id || !postedPostId) continue;
        const insights = await getInstagramMediaInsights(conn, pub.external_id);
        const { error } = await admin
          .from("posts")
          .update({
            reach: insights.reach ?? 0,
            impressions: insights.impressions ?? 0,
            likes: insights.likes ?? 0,
            comments: insights.comments ?? 0,
            shares: insights.shares ?? 0,
            saves: insights.saves ?? 0,
          })
          .eq("id", postedPostId);
        if (!error) summary.postsUpdated += 1;
      }
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({
        tenant: conn.tenantSlug,
        toolkit: "instagram",
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  // ── LinkedIn ───────────────────────────────────────────────────
  for (const conn of await listActiveConnections("linkedin")) {
    try {
      const { data: pubs } = await admin
        .from("scheduled_post_publications")
        .select(
          "external_id, posted_at, scheduled_post:scheduled_posts(posted_post_id)"
        )
        .eq("tenant_slug", conn.tenantSlug)
        .eq("provider", "composio")
        .eq("platform", "linkedin")
        .eq("status", "published")
        .gte("posted_at", sinceIso);

      for (const pub of (pubs ?? []) as unknown as PublicationRow[]) {
        const postedPostId = pub.scheduled_post?.posted_post_id;
        if (!pub.external_id || !postedPostId) continue;
        const stats = await getLinkedInShareStats(conn, pub.external_id);
        const { error } = await admin
          .from("posts")
          .update({
            likes: stats.likes ?? 0,
            comments: stats.comments ?? 0,
            shares: stats.shares ?? 0,
          })
          .eq("id", postedPostId);
        if (!error) summary.postsUpdated += 1;
      }
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({
        tenant: conn.tenantSlug,
        toolkit: "linkedin",
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  // ── TikTok ─────────────────────────────────────────────────────
  // TikTok's API doesn't expose per-video insights via a single tool —
  // LIST_VIDEOS returns view/like/comment/share counts in one batch.
  for (const conn of await listActiveConnections("tiktok")) {
    try {
      const videos = await listTikTokVideos(conn, 50);
      const idToStats = new Map(videos.map((v) => [v.id, v] as const));

      const { data: pubs } = await admin
        .from("scheduled_post_publications")
        .select(
          "external_id, posted_at, scheduled_post:scheduled_posts(posted_post_id)"
        )
        .eq("tenant_slug", conn.tenantSlug)
        .eq("provider", "composio")
        .eq("platform", "tiktok")
        .eq("status", "published")
        .gte("posted_at", sinceIso);

      for (const pub of (pubs ?? []) as unknown as PublicationRow[]) {
        const postedPostId = pub.scheduled_post?.posted_post_id;
        if (!pub.external_id || !postedPostId) continue;
        const stats = idToStats.get(pub.external_id);
        if (!stats) continue;
        const { error } = await admin
          .from("posts")
          .update({
            impressions: stats.viewCount ?? 0,
            likes: stats.likeCount ?? 0,
            comments: stats.commentCount ?? 0,
            shares: stats.shareCount ?? 0,
          })
          .eq("id", postedPostId);
        if (!error) summary.postsUpdated += 1;
      }
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({
        tenant: conn.tenantSlug,
        toolkit: "tiktok",
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return NextResponse.json(summary);
}
