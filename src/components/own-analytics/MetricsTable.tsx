"use client";

import { useTransition } from "react";
import { formatDate } from "@/lib/utils/format";
import { Trash2 } from "lucide-react";
import { deleteOwnMetric } from "@/lib/actions/own-metrics";
import { useDialogs } from "@/components/ui/Dialog";
import type { OwnPostMetric } from "@/lib/types/own-metrics";

function formatNumber(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function MetricsTable({
  metrics,
  tenantSlug,
}: {
  metrics: OwnPostMetric[];
  tenantSlug: string;
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();

  const handleDelete = async (id: string) => {
    const ok = await dialogs.confirm({
      title: "Delete this metric row?",
      subtitle:
        "The post will disappear from your Own analytics history. This can't be undone.",
      tone: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteOwnMetric(id, tenantSlug);
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't delete metric",
          subtitle: res.error,
          tone: "destructive",
        });
      }
    });
  };

  if (metrics.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-border p-10 text-center">
        <h3 className="text-foreground font-semibold mb-1">No data imported yet</h3>
        <p className="text-text-muted text-sm">
          Export a CSV from Meta/TikTok/LinkedIn, or snap a screenshot of any
          post&apos;s metrics page and drop it above.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-text-muted font-medium">
                Platform
              </th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-text-muted font-medium">
                Title / Caption
              </th>
              <th className="text-right px-4 py-3 text-xs uppercase tracking-wide text-text-muted font-medium">
                Views
              </th>
              <th className="text-right px-4 py-3 text-xs uppercase tracking-wide text-text-muted font-medium">
                Likes
              </th>
              <th className="text-right px-4 py-3 text-xs uppercase tracking-wide text-text-muted font-medium">
                Comments
              </th>
              <th className="text-right px-4 py-3 text-xs uppercase tracking-wide text-text-muted font-medium">
                ER
              </th>
              <th className="text-right px-4 py-3 text-xs uppercase tracking-wide text-text-muted font-medium">
                Date
              </th>
              <th className="px-2 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const labelSource =
                m.source === "csv" ? "CSV" : m.source === "screenshot" ? "Vision" : "Manual";
              const display =
                m.title ?? m.caption ?? (m.externalUrl ? "(link)" : "(untitled)");
              return (
                <tr
                  key={m.id}
                  className="border-b border-border/30 last:border-0 hover:bg-sidebar/40"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="capitalize text-foreground">
                        {m.platform}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-sidebar text-text-muted">
                        {labelSource}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[260px]">
                    {m.externalUrl ? (
                      <a
                        href={m.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground hover:text-primary-500 truncate block"
                        title={display}
                      >
                        {display}
                      </a>
                    ) : (
                      <span
                        className="text-foreground/80 truncate block"
                        title={display}
                      >
                        {display}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground font-mono">
                    {formatNumber(m.metrics.views ?? m.metrics.impressions)}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground font-mono">
                    {formatNumber(m.metrics.likes)}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground font-mono">
                    {formatNumber(m.metrics.comments)}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground font-mono">
                    {m.metrics.engagement_rate !== undefined
                      ? `${m.metrics.engagement_rate}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-text-muted text-xs whitespace-nowrap">
                    {formatDate(m.capturedAt, {
                      month: "short",
                      day: "numeric",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="px-2 py-3">
                    <button
                      onClick={() => handleDelete(m.id)}
                      disabled={isPending}
                      aria-label="Delete row"
                      className="p-1.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
