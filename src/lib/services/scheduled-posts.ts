import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScheduledPost, ScheduledPostStatus } from "@/lib/types/scheduled-posts";

interface Row {
  id: string;
  tenant_slug: string;
  platform: string;
  content: string;
  scheduled_for: string;
  posted_at: string | null;
  platform_post_url: string | null;
  status: string;
  error_message: string | null;
  source: string;
  created_at: string;
}

function rowTo(row: Row): ScheduledPost {
  const status: ScheduledPostStatus =
    row.status === "scheduled" ||
    row.status === "publishing" ||
    row.status === "published" ||
    row.status === "failed"
      ? row.status
      : "draft";
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    platform: row.platform,
    content: row.content,
    scheduledFor: row.scheduled_for,
    postedAt: row.posted_at,
    platformPostUrl: row.platform_post_url,
    status,
    errorMessage: row.error_message,
    source: row.source ?? "composer",
    createdAt: row.created_at,
  };
}

export async function listScheduledPosts(
  tenantSlug: string,
  options: { from?: string; to?: string; limit?: number } = {}
): Promise<ScheduledPost[]> {
  const supabase = await createClient();
  let query = supabase
    .from("scheduled_posts")
    .select("id, tenant_slug, platform, content, scheduled_for, posted_at, platform_post_url, status, error_message, source, created_at")
    .eq("tenant_slug", tenantSlug)
    .order("scheduled_for", { ascending: true })
    .limit(options.limit ?? 200);
  if (options.from) query = query.gte("scheduled_for", options.from);
  if (options.to) query = query.lte("scheduled_for", options.to);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as Row[]).map(rowTo);
}

// ── Publishing group (client-injected — REST /api/v1 and MCP tools share
//    these; the functions above are the narrower calendar-UI shape and are
//    left untouched) ────────────────────────────────────────────────────

export interface PublishQueueItem {
  id: string;
  platform: string;
  content: string;
  mediaPaths: string[];
  scheduledFor: string;
  status: string;
}

export async function listPublishQueue(
  client: SupabaseClient,
  tenantSlug: string,
  filter: { platform?: string; status?: string; due?: boolean; limit?: number; offset?: number } = {}
): Promise<{ data: PublishQueueItem[]; total: number }> {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;
  const status = filter.status ?? "scheduled";

  let query = client
    .from("scheduled_posts")
    .select("id, platform, content, media_paths, scheduled_for, status", { count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .eq("status", status)
    .order("scheduled_for", { ascending: true })
    .range(offset, offset + limit - 1);
  if (filter.platform) query = query.eq("platform", filter.platform);
  if (filter.due) query = query.lte("scheduled_for", new Date().toISOString());

  const { data, error, count } = await query;
  if (error || !data) return { data: [], total: 0 };

  return {
    data: data.map((row) => ({
      id: row.id,
      platform: row.platform,
      content: row.content,
      mediaPaths: row.media_paths ?? [],
      scheduledFor: row.scheduled_for,
      status: row.status,
    })),
    total: count ?? 0,
  };
}

/** Mirrors the qstash-publish webhook's success write path, for a post
 * published manually (by a browser-driven agent) rather than via QStash.
 * `source` is deliberately left untouched — see docs/API-V1.md deviations. */
export async function recordManualPublish(
  client: SupabaseClient,
  tenantSlug: string,
  id: string,
  input: { platformPostId: string; platformPostUrl: string; postedAt?: string }
): Promise<{ ok: true } | { ok: false; error: string; status: 404 | 409 | 500 }> {
  const { data: existing } = await client
    .from("scheduled_posts")
    .select("id, status")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: "Post not found", status: 404 };
  }

  // Conditional UPDATE (status != 'published') instead of check-then-write —
  // two concurrent calls racing the maybeSingle() check above would otherwise
  // both pass it and both report success. Zero rows affected means someone
  // else's update won the race in between, not that this one failed.
  const { data: updated, error } = await client
    .from("scheduled_posts")
    .update({
      status: "published",
      posted_at: input.postedAt ?? new Date().toISOString(),
      platform_post_id: input.platformPostId,
      platform_post_url: input.platformPostUrl,
    })
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .neq("status", "published")
    .select("id");
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "Already published", status: 409 };
  }

  return { ok: true };
}

const OWN_POST_METRICS_PLATFORM_MAP: Record<string, string | null> = {
  x: "twitter",
  twitter: "twitter",
  instagram: "instagram",
  tiktok: "tiktok",
  linkedin: "linkedin",
  youtube: null,
};

export interface ManualMetricsInput {
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  views?: number;
  observedAt?: string;
  notes?: string;
}

/** Upserts own_post_metrics the same way /api/cron/sync-post-metrics does
 * for source='api' rows, but source='manual' and keyed off a human
 * observation instead of the SocialAPI.ai poll. */
export async function recordManualMetrics(
  client: SupabaseClient,
  tenantSlug: string,
  id: string,
  input: ManualMetricsInput
): Promise<{ ok: true } | { ok: false; error: string; status: 400 | 404 | 500 }> {
  const { data: post } = await client
    .from("scheduled_posts")
    .select("id, platform, content, platform_post_url, posted_at")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (!post) return { ok: false, error: "Post not found", status: 404 };

  const mappedPlatform = OWN_POST_METRICS_PLATFORM_MAP[post.platform] ?? null;
  if (!mappedPlatform) {
    return {
      ok: false,
      error: `Metrics aren't supported for platform: ${post.platform}`,
      status: 400,
    };
  }

  const { likes, comments, shares, saves, views, observedAt, notes } = input;
  const { error } = await client.from("own_post_metrics").upsert(
    {
      tenant_slug: tenantSlug,
      scheduled_post_id: post.id,
      platform: mappedPlatform,
      caption: post.content.slice(0, 500),
      external_url: post.platform_post_url ?? null,
      captured_at: observedAt ?? post.posted_at ?? new Date().toISOString(),
      source: "manual",
      // own_post_metrics.metrics is a loose jsonb blob — `notes` has no
      // dedicated column, so it rides along inside it.
      metrics: { likes, comments, shares, saves, views, notes },
    },
    { onConflict: "scheduled_post_id,platform", ignoreDuplicates: false }
  );
  if (error) return { ok: false, error: error.message, status: 500 };

  return { ok: true };
}

export interface CalendarDay {
  date: string;
  dayLabel: string;
  isoDate: string;
  posts: { id: string; platform: string; status: ScheduledPostStatus; content: string }[];
}

export function buildCalendarWeek(
  posts: ScheduledPost[],
  startDate: Date = new Date()
): CalendarDay[] {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const iso = day.toISOString().slice(0, 10);
    const dayLabel = day.toLocaleDateString("en-US", { weekday: "short" });
    const date = day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const postsForDay = posts
      .filter((p) => p.scheduledFor.slice(0, 10) === iso)
      .map((p) => ({
        id: p.id,
        platform: p.platform,
        status: p.status,
        content: p.content.slice(0, 60),
      }));
    days.push({ date, dayLabel, isoDate: iso, posts: postsForDay });
  }
  return days;
}
