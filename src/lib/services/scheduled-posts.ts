import { createClient } from "@/lib/supabase/server";
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
