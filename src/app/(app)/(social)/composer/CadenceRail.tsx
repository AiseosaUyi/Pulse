"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTransition } from "react";
import { Check, Circle, CircleDot, Clock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { markAsPosted } from "@/lib/actions/cadence";
import {
  PLATFORM_LABEL,
  type CadencePlatform,
  type Tracker,
  type WindowStatus,
} from "@/lib/cadence/types";

const STATUS_META: Record<WindowStatus, { label: string; tone: string; Icon: typeof Check }> = {
  done: { label: "Done", tone: "text-gray-500", Icon: Check },
  now: { label: "Now", tone: "text-primary-500", Icon: CircleDot },
  missed: { label: "Missed", tone: "text-gray-400", Icon: Circle },
  upcoming: { label: "Upcoming", tone: "text-gray-1000", Icon: Clock },
};

export function CadenceRail({
  tracker,
  tenantSlug,
}: {
  tracker: Tracker | null;
  tenantSlug: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function mark(platform: CadencePlatform, windowId: string | null) {
    startTransition(async () => {
      const res = await markAsPosted(tenantSlug, { windowId, platform });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Logged — nice.");
      router.refresh();
    });
  }

  if (!tracker) {
    return (
      <aside className="rounded-2xl border border-white-200 bg-card p-5">
        <h2 className="text-sm font-bold text-gray-1100">Cadence</h2>
        <p className="mt-2 text-sm text-gray-1000">
          Set your posting windows and per-platform targets to start tracking your beat.
        </p>
        <Link
          href="/settings/cadence"
          className="mt-3 inline-block text-sm font-medium text-primary-500 hover:text-primary-600"
        >
          Set your cadence →
        </Link>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col gap-5 rounded-2xl border border-white-200 bg-card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-gray-1100">Today</h2>
        {tracker.behind && (
          <span className="text-xs font-medium text-primary-600">You&apos;re behind</span>
        )}
      </div>

      {tracker.platforms.map((pt) => (
        <div key={pt.platform} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-1000">
              {PLATFORM_LABEL[pt.platform]}
            </span>
            <span className="text-sm tabular-nums text-gray-1000">
              <span className={cn("font-bold", pt.behind ? "text-primary-500" : "text-gray-1100")}>
                {pt.posted}
              </span>{" "}
              / {pt.target}
            </span>
          </div>

          <ul className="flex flex-col gap-1">
            {pt.windows.map((w) => {
              const meta = STATUS_META[w.status];
              const Icon = meta.Icon;
              return (
                <li key={w.id} className="flex items-center gap-3 py-1">
                  <Icon className={cn("size-4 shrink-0", meta.tone)} aria-hidden />
                  <span className="flex-1 text-sm text-gray-1200">{w.label}</span>
                  <span className="text-xs tabular-nums text-gray-1000">{w.time}</span>
                  {w.status === "done" ? (
                    <span className={cn("w-20 text-right text-xs font-medium", meta.tone)}>{meta.label}</span>
                  ) : (
                    <Button
                      type="button"
                      size="xs"
                      variant={w.status === "now" ? "default" : "tertiary"}
                      disabled={pending}
                      onClick={() => mark(pt.platform, w.id)}
                      aria-label={`Mark ${w.label} (${PLATFORM_LABEL[pt.platform]}) as posted`}
                    >
                      Mark posted
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            disabled={pending}
            onClick={() => mark(pt.platform, null)}
            className="inline-flex items-center gap-1 self-start text-xs text-gray-1000 hover:text-gray-1200 disabled:opacity-50"
          >
            <Plus className="size-3.5" aria-hidden /> Log a {PLATFORM_LABEL[pt.platform]} post
          </button>
        </div>
      ))}

      {/* 7-day strip */}
      <div className="border-t border-white-200 pt-3">
        <div className="mb-1.5 text-xs text-gray-1000">Last 7 days</div>
        <div
          className="flex gap-1.5"
          role="img"
          aria-label={`${tracker.daysActiveThisWeek} of the last 7 days active`}
        >
          {tracker.week.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${d.count} post${d.count === 1 ? "" : "s"}`}
              className={cn(
                "h-6 flex-1 rounded",
                d.count === 0 && "bg-gray-100",
                d.count > 0 && d.count < 3 && "bg-primary-200",
                d.count >= 3 && "bg-primary-500",
                d.isToday && "ring-2 ring-blue-500/30"
              )}
            />
          ))}
        </div>
        <div className="mt-2 text-xs text-gray-1000">
          <span className="font-bold text-gray-1100">{tracker.daysActiveThisWeek}</span>/7 days active
        </div>
      </div>
    </aside>
  );
}
