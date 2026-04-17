import { createClient } from "@/lib/supabase/server";
import type { ScheduledPost, ScheduledPostStatus } from "@/lib/types/scheduled-posts";

interface Row {
  id: string;
  tenant_slug: string;
  brief_id: string | null;
  platform: string;
  content_type: string | null;
  caption: string | null;
  best_time: string | null;
  scheduled_for: string;
  status: string;
  posted_post_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  content_briefs?: { title: string } | null;
}

function rowTo(row: Row): ScheduledPost {
  const status: ScheduledPostStatus =
    row.status === "scheduled" || row.status === "posted" || row.status === "dismissed"
      ? row.status
      : "draft";
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    briefId: row.brief_id,
    platform: row.platform,
    contentType: row.content_type,
    caption: row.caption,
    bestTime: row.best_time,
    scheduledFor: row.scheduled_for,
    status,
    postedPostId: row.posted_post_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    briefTitle: row.content_briefs?.title ?? null,
  };
}

export async function listScheduledPosts(
  tenantSlug: string,
  options: { from?: string; to?: string; limit?: number } = {}
): Promise<ScheduledPost[]> {
  const supabase = await createClient();
  let query = supabase
    .from("scheduled_posts")
    .select("*, content_briefs(title)")
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
  posts: { id: string; platform: string; status: ScheduledPostStatus }[];
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
      .map((p) => ({ id: p.id, platform: p.platform, status: p.status }));
    days.push({ date, dayLabel, posts: postsForDay });
  }
  return days;
}
