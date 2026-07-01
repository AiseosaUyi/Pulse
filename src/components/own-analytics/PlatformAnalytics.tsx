"use client";

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { OwnPostMetric, OwnMetricsPlatform } from "@/lib/types/own-metrics";

/* ── helpers ── */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Repairs captions where UTF-8 bytes were misread as Latin-1 (mojibake).
// Pattern: â€™ → ', ð[box] → emoji, etc. Falls back to original on failure.
function cleanCaption(text: string | null | undefined): string {
  if (!text) return "";
  if (/â€|Ã[À-ÿ]/.test(text)) {
    try {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
      const fixed = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!fixed.includes("�")) return fixed;
    } catch { /* fall through */ }
  }
  // Strip lone high bytes that couldn't decode (e.g. bare ð without continuation bytes)
  return text.replace(/[\x80-\x9F�]/g, "").replace(/\s{2,}/g, " ").trim();
}

interface KpiProps { label: string; value: string; sub?: string; trend?: "up" | "down" | "flat" }
function KpiCard({ label, value, sub, trend }: KpiProps) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <p className="text-[11px] text-text-muted mb-1">{label}</p>
      <div className="flex items-end gap-2">
        <p className="text-2xl font-bold text-foreground tracking-tight" style={{ fontFamily: "'Satoshi-700', var(--font-sans)" }}>{value}</p>
        {sub && (
          <span className={`text-[11px] mb-0.5 flex items-center gap-0.5 ${trend === "up" ? "text-status-green" : trend === "down" ? "text-red-500" : "text-text-muted"}`}>
            {trend === "up" ? <TrendingUp size={10} /> : trend === "down" ? <TrendingDown size={10} /> : <Minus size={10} />}
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── axis / tooltip styling ── */
const axisStyle = { fill: "var(--color-text-muted)", fontSize: 10 };
const CustomTooltip = ({ active, payload, label }: Record<string, unknown>) => {
  if (!active || !Array.isArray(payload) || !payload.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-text-muted mb-1">{String(label)}</p>
      {(payload as Array<{name: string; value: number; color?: string}>).map((p, i) => (
        <p key={i} style={{ color: p.color ?? "var(--color-primary-500)" }}>
          {p.name}: <strong>{fmt(p.value)}</strong>
        </p>
      ))}
    </div>
  );
};

/* ── Top posts table ── */
function TopPostsTable({ posts, metricKey, metricLabel }: {
  posts: OwnPostMetric[];
  metricKey: string;
  metricLabel: string;
}) {
  const sorted = [...posts]
    .filter((p) => (p.metrics as Record<string, number>)[metricKey] > 0)
    .sort((a, b) => ((b.metrics as Record<string, number>)[metricKey] ?? 0) - ((a.metrics as Record<string, number>)[metricKey] ?? 0))
    .slice(0, 10);

  if (!sorted.length) return <p className="text-xs text-text-muted italic">No posts with {metricLabel} data yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40">
            <th className="text-left py-2 pr-3 text-text-muted font-medium">#</th>
            <th className="text-left py-2 pr-3 text-text-muted font-medium">Date</th>
            <th className="text-left py-2 pr-3 text-text-muted font-medium max-w-[260px]">Caption</th>
            <th className="text-right py-2 text-text-muted font-medium">{metricLabel}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr key={p.id} className="border-b border-border/20 hover:bg-sidebar/30 transition-colors">
              <td className="py-2 pr-3 text-text-muted">{i + 1}</td>
              <td className="py-2 pr-3 text-text-muted whitespace-nowrap">{shortDate(p.capturedAt)}</td>
              <td className="py-2 pr-3 max-w-[260px]">
                <div className="flex items-start gap-1">
                  <span className="text-foreground line-clamp-2 leading-snug">{cleanCaption(p.caption || p.title) || "—"}</span>
                  {p.externalUrl && (
                    <a href={p.externalUrl} target="_blank" rel="noreferrer" className="shrink-0 mt-0.5 text-primary-500 hover:text-primary-600">
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </td>
              <td className="py-2 text-right font-mono text-foreground">
                {fmt((p.metrics as Record<string, number>)[metricKey] ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── build time-series for charts ── */
function buildDailySeries(posts: OwnPostMetric[], metricKey: string) {
  const byDay = new Map<string, number>();
  for (const p of posts) {
    const day = p.capturedAt.slice(0, 10);
    const val = (p.metrics as Record<string, number>)[metricKey] ?? 0;
    byDay.set(day, (byDay.get(day) ?? 0) + val);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date: shortDate(date), value }));
}

function buildPostingFrequency(posts: OwnPostMetric[]) {
  const byDay = new Map<string, number>();
  for (const p of posts) {
    const day = p.capturedAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date: shortDate(date), count }));
}

interface MonthlyRow { month: string; impressions: number; likes: number; engagements: number; saves: number; posts: number }
function buildMonthlySeries(posts: OwnPostMetric[]): MonthlyRow[] {
  const byMonth = new Map<string, MonthlyRow>();
  for (const p of posts) {
    const key = p.capturedAt.slice(0, 7);
    const cur = byMonth.get(key) ?? { month: key, impressions: 0, likes: 0, engagements: 0, saves: 0, posts: 0 };
    const m = p.metrics as Record<string, number>;
    const eng = m.engagements ?? (m.likes ?? 0) + (m.replies ?? 0) + (m.shares ?? 0) + (m.comments ?? 0);
    byMonth.set(key, {
      month: new Date(key + "-01").toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      impressions: cur.impressions + (m.impressions ?? 0),
      likes: cur.likes + (m.likes ?? 0),
      engagements: cur.engagements + eng,
      saves: cur.saves + (m.saves ?? 0),
      posts: cur.posts + 1,
    });
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row);
}

function MonthlyChart({ posts, metricKey, metricLabel, color }: {
  posts: OwnPostMetric[];
  metricKey: keyof MonthlyRow;
  metricLabel: string;
  color?: string;
}) {
  const data = buildMonthlySeries(posts);
  if (data.length < 2) return null;
  const hasData = data.some((d) => (d[metricKey] as number) > 0);
  if (!hasData) return null;
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <p className="text-xs font-semibold text-text-muted mb-4">{metricLabel} by month</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barSize={18}>
          <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={fmt} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey={metricKey as string} name={metricLabel} fill={color ?? "var(--color-primary-500)"} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ══════════════════════════════════════
   INSTAGRAM
══════════════════════════════════════ */
export function InstagramAnalytics({ posts }: { posts: OwnPostMetric[] }) {
  const igPosts = posts.filter((p) => p.platform === "instagram");
  if (!igPosts.length) return <EmptyState platform="Instagram" />;

  const photos = igPosts.filter((p) => (p.metrics as Record<string, string>).mediaType !== "reel" && (p.metrics as Record<string, string>).mediaType !== "story");
  const reels = igPosts.filter((p) => (p.metrics as Record<string, string>).mediaType === "reel");
  const stories = igPosts.filter((p) => (p.metrics as Record<string, string>).mediaType === "story");

  const totalReach = igPosts.reduce((s, p) => s + ((p.metrics as Record<string, number>).reach ?? 0), 0);
  const totalImpressions = igPosts.reduce((s, p) => s + ((p.metrics as Record<string, number>).impressions ?? 0), 0);
  const totalLikes = igPosts.reduce((s, p) => s + ((p.metrics as Record<string, number>).likes ?? 0), 0);
  const totalSaves = igPosts.reduce((s, p) => s + ((p.metrics as Record<string, number>).saves ?? 0), 0);

  const frequencySeries = buildPostingFrequency(igPosts);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Posts tracked" value={String(igPosts.length)} />
        <KpiCard label="Photos / Reels / Stories" value={`${photos.length} / ${reels.length} / ${stories.length}`} />
        {totalImpressions > 0 && <KpiCard label="Total impressions" value={fmt(totalImpressions)} />}
        {totalReach > 0 && <KpiCard label="Total reach" value={fmt(totalReach)} />}
        {totalLikes > 0 && <KpiCard label="Total likes" value={fmt(totalLikes)} />}
        {totalSaves > 0 && <KpiCard label="Total saves" value={fmt(totalSaves)} />}
      </div>

      {/* Monthly impressions chart */}
      <MonthlyChart posts={igPosts} metricKey="impressions" metricLabel="Impressions" color="#E1306C" />
      <MonthlyChart posts={igPosts} metricKey="likes" metricLabel="Likes" color="var(--color-primary-500)" />

      {/* Posting frequency chart */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <p className="text-xs font-semibold text-text-muted mb-4">Posting frequency</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={frequencySeries} barSize={8}>
            <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="count" name="Posts" fill="var(--color-primary-500)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top posts */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <p className="text-xs font-semibold text-text-muted mb-4">Top posts by likes</p>
        <TopPostsTable posts={igPosts} metricKey="likes" metricLabel="Likes" />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   TWITTER / X
══════════════════════════════════════ */
export function TwitterAnalytics({ posts }: { posts: OwnPostMetric[] }) {
  const tweets = posts.filter((p) => p.platform === "twitter");
  if (!tweets.length) return <EmptyState platform="X / Twitter" />;

  const totalImpressions = tweets.reduce((s, p) => s + ((p.metrics as Record<string, number>).impressions ?? 0), 0);
  const totalEngagements = tweets.reduce((s, p) => s + ((p.metrics as Record<string, number>).engagements ?? 0), 0);
  const totalLikes = tweets.reduce((s, p) => s + ((p.metrics as Record<string, number>).likes ?? 0), 0);
  const totalRetweets = tweets.reduce((s, p) => s + ((p.metrics as Record<string, number>).shares ?? 0), 0);
  const totalReplies = tweets.reduce((s, p) => s + ((p.metrics as Record<string, number>).replies ?? 0), 0);
  const totalBookmarks = tweets.reduce((s, p) => s + ((p.metrics as Record<string, number>).bookmarks ?? 0), 0);
  const avgEr = totalImpressions > 0 ? ((totalEngagements / totalImpressions) * 100).toFixed(2) : null;

  const impressionsSeries = buildDailySeries(tweets, "impressions");
  const engSeries = buildDailySeries(tweets, "engagements");

  return (
    <div className="space-y-6">
      {/* KPI row — exactly like Twitter Analytics dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <KpiCard label="Tweets" value={String(tweets.length)} />
        {totalImpressions > 0 && <KpiCard label="Impressions" value={fmt(totalImpressions)} />}
        {totalEngagements > 0 && <KpiCard label="Engagements" value={fmt(totalEngagements)} />}
        {avgEr && <KpiCard label="Eng. rate" value={`${avgEr}%`} />}
        <KpiCard label="Likes" value={fmt(totalLikes)} />
        <KpiCard label="Retweets" value={fmt(totalRetweets)} />
        <KpiCard label="Replies" value={fmt(totalReplies)} />
        {totalBookmarks > 0 && <KpiCard label="Bookmarks" value={fmt(totalBookmarks)} />}
      </div>

      {/* Monthly chart */}
      <MonthlyChart posts={tweets} metricKey="impressions" metricLabel="Impressions" color="#4F9CF9" />

      {/* Daily impressions bar chart */}
      {impressionsSeries.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-xs font-semibold text-text-muted mb-4">Impressions — daily</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={impressionsSeries} barSize={10}>
              <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Impressions" fill="#4F9CF9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Engagement line chart */}
      {engSeries.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-xs font-semibold text-text-muted mb-4">Engagements over time</p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={engSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" name="Engagements" stroke="var(--color-primary-500)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top tweets */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <p className="text-xs font-semibold text-text-muted mb-4">Top tweets by impressions</p>
        <TopPostsTable
          posts={tweets}
          metricKey={totalImpressions > 0 ? "impressions" : "likes"}
          metricLabel={totalImpressions > 0 ? "Impressions" : "Likes"}
        />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   TIKTOK
══════════════════════════════════════ */
export function TikTokAnalytics({ posts }: { posts: OwnPostMetric[] }) {
  const videos = posts.filter((p) => p.platform === "tiktok");
  if (!videos.length) return <EmptyState platform="TikTok" />;

  const totalViews = videos.reduce((s, p) => s + ((p.metrics as Record<string, number>).views ?? 0), 0);
  const totalLikes = videos.reduce((s, p) => s + ((p.metrics as Record<string, number>).likes ?? 0), 0);
  const totalComments = videos.reduce((s, p) => s + ((p.metrics as Record<string, number>).comments ?? 0), 0);
  const totalShares = videos.reduce((s, p) => s + ((p.metrics as Record<string, number>).shares ?? 0), 0);

  const viewsSeries = buildDailySeries(videos, "views");
  const likesSeries = buildDailySeries(videos, "likes");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Videos" value={String(videos.length)} />
        {totalViews > 0 && <KpiCard label="Total views" value={fmt(totalViews)} />}
        <KpiCard label="Total likes" value={fmt(totalLikes)} />
        {totalComments > 0 && <KpiCard label="Comments" value={fmt(totalComments)} />}
        {totalShares > 0 && <KpiCard label="Shares" value={fmt(totalShares)} />}
      </div>

      {/* Monthly views chart */}
      <MonthlyChart posts={videos} metricKey="impressions" metricLabel="Views" color="#FE2C55" />

      {viewsSeries.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-xs font-semibold text-text-muted mb-4">Views — daily</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={viewsSeries} barSize={10}>
              <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Views" fill="#FE2C55" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl p-5">
        <p className="text-xs font-semibold text-text-muted mb-4">Top videos by {totalViews > 0 ? "views" : "likes"}</p>
        <TopPostsTable
          posts={videos}
          metricKey={totalViews > 0 ? "views" : "likes"}
          metricLabel={totalViews > 0 ? "Views" : "Likes"}
        />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   LINKEDIN
══════════════════════════════════════ */
export function LinkedInAnalytics({ posts }: { posts: OwnPostMetric[] }) {
  const lkPosts = posts.filter((p) => p.platform === "linkedin");
  if (!lkPosts.length) return <EmptyState platform="LinkedIn" />;

  const totalImpressions = lkPosts.reduce((s, p) => s + ((p.metrics as Record<string, number>).impressions ?? 0), 0);
  const totalClicks = lkPosts.reduce((s, p) => s + ((p.metrics as Record<string, number>).views ?? 0), 0);
  const totalLikes = lkPosts.reduce((s, p) => s + ((p.metrics as Record<string, number>).likes ?? 0), 0);
  const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : null;

  const impSeries = buildDailySeries(lkPosts, "impressions");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Posts" value={String(lkPosts.length)} />
        {totalImpressions > 0 && <KpiCard label="Impressions" value={fmt(totalImpressions)} />}
        {totalClicks > 0 && <KpiCard label="Clicks" value={fmt(totalClicks)} />}
        {avgCtr && <KpiCard label="CTR" value={`${avgCtr}%`} />}
        <KpiCard label="Reactions" value={fmt(totalLikes)} />
      </div>

      {/* Monthly chart */}
      <MonthlyChart posts={lkPosts} metricKey="impressions" metricLabel="Impressions" color="#0A66C2" />

      {impSeries.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-xs font-semibold text-text-muted mb-4">Impressions — daily</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={impSeries} barSize={10}>
              <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Impressions" fill="#0A66C2" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl p-5">
        <p className="text-xs font-semibold text-text-muted mb-4">Top posts by impressions</p>
        <TopPostsTable posts={lkPosts} metricKey="impressions" metricLabel="Impressions" />
      </div>
    </div>
  );
}

/* ── empty state ── */
function EmptyState({ platform }: { platform: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
      <p className="text-sm font-medium text-foreground">{platform} — no data yet</p>
      <p className="text-xs text-text-muted mt-1">Upload your {platform} data export or a CSV from your analytics dashboard.</p>
    </div>
  );
}
