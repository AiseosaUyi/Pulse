"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { ScheduledPost } from "@/lib/types/scheduled-posts";

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "#E1306C",
  linkedin: "#0A66C2",
  tiktok: "#010101",
  youtube: "#FF0000",
  x: "#000000",
};

const STATUS_DOT: Record<string, string> = {
  draft: "bg-warning-500",
  scheduled: "bg-secondary-500",
  publishing: "bg-blue-400",
  published: "bg-success-500",
  failed: "bg-error-500",
};

function getMondayOf(dateStr: string): Date {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function CalendarView({
  initialPosts,
  initialWeekStart,
}: {
  initialPosts: ScheduledPost[];
  initialWeekStart: string;
}) {
  const [weekStart, setWeekStart] = useState<Date>(() =>
    getMondayOf(initialWeekStart.slice(0, 10))
  );

  const today = isoDate(new Date());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    const iso = isoDate(d);
    const posts = initialPosts.filter((p) => p.scheduledFor.slice(0, 10) === iso);
    return {
      iso,
      dayLabel: d.toLocaleDateString("en-US", { weekday: "short" }),
      dayNum: d.getDate(),
      month: d.toLocaleDateString("en-US", { month: "short" }),
      isToday: iso === today,
      posts,
    };
  });

  const rangeLabel = (() => {
    const start = weekStart;
    const end = addDays(weekStart, 6);
    const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${startStr} – ${endStr}`;
  })();

  return (
    <div className="bg-card rounded-2xl border border-border p-5 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">{rangeLabel}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="flex size-7 items-center justify-center rounded-lg border border-border text-text-muted hover:text-foreground hover:bg-card-hover transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => setWeekStart(getMondayOf(today))}
            className="px-2 py-1 rounded-lg border border-border text-xs text-text-muted hover:text-foreground hover:bg-card-hover transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="flex size-7 items-center justify-center rounded-lg border border-border text-text-muted hover:text-foreground hover:bg-card-hover transition-colors"
            aria-label="Next week"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Day grid — scrollable on mobile */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-2 min-w-[560px]">
          {days.map((day) => (
            <div key={day.iso} className="flex flex-col gap-1.5">
              {/* Day header */}
              <div className="text-center mb-1">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">{day.dayLabel}</p>
                <div
                  className={[
                    "mx-auto mt-0.5 flex size-6 items-center justify-center rounded-full text-xs font-medium",
                    day.isToday
                      ? "bg-primary-500 text-white"
                      : "text-foreground",
                  ].join(" ")}
                >
                  {day.dayNum}
                </div>
              </div>

              {/* Day cell */}
              <div
                className={[
                  "rounded-xl border min-h-[90px] flex flex-col gap-1.5 p-2 transition-colors",
                  day.isToday ? "border-primary-500/40 bg-primary-50/30" : "border-border bg-background/50",
                ].join(" ")}
              >
                {day.posts.length === 0 ? (
                  <Link
                    href={`/composer?date=${day.iso}`}
                    className="flex flex-1 items-center justify-center opacity-0 hover:opacity-100 transition-opacity group"
                    title="Draft a post for this day"
                  >
                    <span className="flex items-center gap-0.5 text-[10px] text-text-muted group-hover:text-primary-500">
                      <Plus size={10} /> Draft
                    </span>
                  </Link>
                ) : (
                  day.posts.map((post) => {
                    const color = PLATFORM_COLORS[post.platform] ?? "#888";
                    const dot = STATUS_DOT[post.status] ?? "bg-text-muted";
                    return (
                      <div
                        key={post.id}
                        className="rounded-lg p-1.5 text-[10px] leading-tight"
                        style={{ backgroundColor: `${color}14`, borderLeft: `2px solid ${color}` }}
                        title={post.content}
                      >
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className={`size-1.5 rounded-full shrink-0 ${dot}`} />
                          <span className="font-medium capitalize" style={{ color }}>
                            {post.platform}
                          </span>
                        </div>
                        <p className="text-text-secondary line-clamp-2 leading-tight">
                          {post.content}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/30 flex-wrap">
        {[
          { dot: "bg-warning-500", label: "Draft" },
          { dot: "bg-secondary-500", label: "Scheduled" },
          { dot: "bg-success-500", label: "Published" },
          { dot: "bg-error-500", label: "Failed" },
        ].map(({ dot, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${dot}`} />
            <span className="text-text-muted text-xs">{label}</span>
          </div>
        ))}
        <Link
          href="/schedule"
          className="ml-auto text-xs text-primary-500 hover:underline"
        >
          Full schedule →
        </Link>
      </div>
    </div>
  );
}
