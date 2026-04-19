"use client";

import { useMemo, useState, useTransition } from "react";
import { Trash2, ExternalLink, Bookmark, Download } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import {
  updateSavedContentStatus,
  deleteSavedContent,
  saveContent,
} from "@/lib/actions/saved-content";
import { useDialogs } from "@/components/ui/Dialog";
import type { SavedContent, SavedContentStatus } from "@/lib/types/saved-content";

interface TrendCard {
  id: string;
  platform: string;
  title: string;
  summary: string;
  url: string | null;
  views: number;
  applicability: "high" | "medium" | "low" | "n/a";
  thumbnailEmoji: string;
}

interface Props {
  tenantSlug: string;
  saved: SavedContent[];
  trends: TrendCard[];
}

const platformColors: Record<string, string> = {
  tiktok: "text-primary-500",
  instagram: "text-primary-500",
  twitter: "text-status-teal",
  youtube: "text-status-red",
  manual: "text-text-muted",
  intel_card: "text-text-muted",
  trend_scout: "text-text-muted",
};

const FILTERS: { key: string; label: string; match: (c: SavedContent) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "new", label: "New", match: (c) => c.status === "new" },
  { key: "scheduled", label: "Scheduled", match: (c) => c.status === "scheduled" },
  { key: "used", label: "Used", match: (c) => c.status === "used" },
];

export function VaultClient({ tenantSlug, saved, trends }: Props) {
  const [filter, setFilter] = useState("all");

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter);
    return f ? saved.filter(f.match) : saved;
  }, [saved, filter]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
      <div className="col-span-1 lg:col-span-3">
        <div className="bg-card rounded-xl border border-border/50">
          <div className="p-5 border-b border-border/50 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              Saved content
            </h2>
            <div className="flex gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    filter === f.key
                      ? "bg-primary-500/10 text-primary-500"
                      : "bg-background text-text-secondary hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-foreground font-medium mb-1">
                {filter === "all" ? "No saved content yet" : `No ${filter} items`}
              </p>
              <p className="text-text-muted text-sm">
                Paste a link above to save your first item.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {visible.map((c) => (
                <SavedRow key={c.id} tenantSlug={tenantSlug} content={c} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="col-span-1 lg:col-span-2">
        <div className="bg-card rounded-xl border border-border/50">
          <div className="p-5 border-b border-border/50">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              Trends in your niche
            </h2>
            <p className="text-text-muted text-xs mt-1">
              From trend scouts. Click the bookmark to save into your vault.
            </p>
          </div>
          {trends.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-text-muted text-sm">
                No trends yet. They&apos;ll appear once the daily scrape runs.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {trends.map((t) => (
                <TrendRow key={t.id} tenantSlug={tenantSlug} trend={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SavedRow({
  tenantSlug,
  content,
}: {
  tenantSlug: string;
  content: SavedContent;
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();

  const cycleStatus = () => {
    const order: SavedContentStatus[] = ["new", "scheduled", "used", "archived"];
    const idx = order.indexOf(content.status);
    const next = order[(idx + 1) % order.length];
    startTransition(async () => {
      const res = await updateSavedContentStatus(tenantSlug, content.id, next);
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't update status",
          subtitle: res.error,
          tone: "destructive",
        });
      }
    });
  };

  const remove = async () => {
    const ok = await dialogs.confirm({
      title: "Delete this saved item?",
      subtitle:
        "It's removed from your vault. The original source on its platform stays where it is.",
      tone: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteSavedContent(tenantSlug, content.id);
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't delete item",
          subtitle: res.error,
          tone: "destructive",
        });
      }
    });
  };

  // The video isn't stored in our bucket anymore — the download proxy
  // re-resolves the source URL on demand. "Downloadable" means the row
  // has an extracted status + a source URL we can re-resolve from.
  const canRedownload =
    content.extractionStatus === "extracted" && !!content.sourceUrl;
  const downloadUrl = `/api/vault/download/${content.id}`;

  return (
    <div className="p-4 hover:bg-card-hover transition-colors group">
      <div className="flex items-start gap-3">
        <a
          href={canRedownload ? downloadUrl : (content.sourceUrl ?? "#")}
          target={canRedownload ? undefined : "_blank"}
          rel={canRedownload ? undefined : "noreferrer"}
          className="w-16 h-16 rounded-lg bg-background overflow-hidden flex-shrink-0 relative flex items-center justify-center text-2xl"
          aria-label={canRedownload ? "Download again" : "Open source"}
        >
          {content.thumbnailUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={content.thumbnailUrl}
                alt=""
                className="w-full h-full object-cover"
              />
              {canRedownload && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <Download size={16} />
                </span>
              )}
            </>
          ) : (
            <span>{content.thumbnailEmoji ?? "🔖"}</span>
          )}
        </a>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              {content.sourceUrl ? (
                <a
                  href={content.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground text-sm font-medium leading-tight hover:text-primary-500 transition-colors flex items-center gap-1"
                >
                  {content.title}
                  <ExternalLink size={11} className="shrink-0 opacity-60" />
                </a>
              ) : (
                <p className="text-foreground text-sm font-medium leading-tight">
                  {content.title}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {content.sourcePlatform && (
                  <span
                    className={`text-xs font-medium capitalize ${platformColors[content.sourcePlatform] ?? "text-text-muted"}`}
                  >
                    {content.sourcePlatform === "manual" ? "Uploaded" : content.sourcePlatform}
                  </span>
                )}
                {content.authorHandle && (
                  <span className="text-text-muted text-xs">
                    @{content.authorHandle}
                  </span>
                )}
                {content.durationSec != null && content.durationSec > 0 && (
                  <span className="text-text-muted text-xs">
                    {content.durationSec}s
                  </span>
                )}
                {content.fileSizeBytes != null && content.fileSizeBytes > 0 && (
                  <span className="text-text-muted text-xs">
                    {Math.round(content.fileSizeBytes / 1024 / 1024 * 10) / 10}MB
                  </span>
                )}
                <span className="text-text-muted text-xs">
                  {new Date(content.updatedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {content.extractionStatus === "link_only" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sidebar border border-border text-text-muted">
                    link only
                  </span>
                )}
                {content.extractionStatus === "extraction_failed" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-red/10 border border-status-red/30 text-status-red">
                    extract failed
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={cycleStatus}
                disabled={isPending}
                className="p-0"
                aria-label="Toggle status"
              >
                <Badge
                  variant={
                    content.status === "used"
                      ? "active"
                      : content.status === "scheduled"
                        ? "opportunity"
                        : content.status === "archived"
                          ? "dismissed"
                          : "high_impact"
                  }
                >
                  {content.status}
                </Badge>
              </button>
              <button
                onClick={remove}
                disabled={isPending}
                className="p-1.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                aria-label="Delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {content.tags.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {content.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded bg-background text-text-muted text-[10px]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {canRedownload && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <a
                href={downloadUrl}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-primary-500/10 text-primary-500 rounded-md hover:bg-primary-500/20 transition-colors font-medium"
              >
                <Download size={12} />
                Download again
              </a>
              {content.sourceUrl && (
                <a
                  href={content.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-background text-text-secondary rounded-md hover:text-foreground border border-border/50"
                >
                  <ExternalLink size={12} />
                  Open source
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TrendRow({
  tenantSlug,
  trend,
}: {
  tenantSlug: string;
  trend: TrendCard;
}) {
  const dialogs = useDialogs();
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await saveContent(tenantSlug, {
        title: trend.title,
        sourcePlatform: trend.platform,
        sourceUrl: trend.url,
        trendScoutId: trend.id,
        thumbnailEmoji: trend.thumbnailEmoji,
      });
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't save to vault",
          subtitle: res.error,
          tone: "destructive",
        });
        return;
      }
      setSaved(true);
    });
  };

  return (
    <div className="p-4 hover:bg-card-hover transition-colors group">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center text-lg flex-shrink-0">
          {trend.thumbnailEmoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-foreground text-sm font-medium leading-tight group-hover:text-primary-500 transition-colors">
            {trend.title}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-text-muted text-xs capitalize">{trend.platform}</span>
            {trend.views > 0 && (
              <>
                <span className="text-text-muted text-xs">·</span>
                <span className="text-text-muted text-xs">
                  {trend.views.toLocaleString()} views
                </span>
              </>
            )}
          </div>
          {trend.summary && (
            <p className="text-text-muted text-xs mt-1.5 line-clamp-2">
              {trend.summary}
            </p>
          )}
          <div className="flex items-center justify-between mt-2">
            <Badge
              variant={
                trend.applicability === "high"
                  ? "high_impact"
                  : trend.applicability === "medium"
                    ? "opportunity"
                    : "dismissed"
              }
            >
              {trend.applicability} fit
            </Badge>
            <button
              onClick={save}
              disabled={isPending || saved}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                saved
                  ? "bg-status-green/10 text-status-green"
                  : "bg-primary-500/10 text-primary-500 hover:bg-primary-500/20"
              }`}
            >
              <Bookmark size={11} />
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
