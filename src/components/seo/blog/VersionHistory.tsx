"use client";

import { useState, useTransition } from "react";
import { History, Undo2, GitCompare, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "./DiffViewer";
import { revertToVersion } from "@/lib/actions/blog-versions";
import { useDialogs } from "@/components/ui/Dialog";
import type { BlogPostVersionRecord } from "@/lib/types/blog-posts";

export function VersionHistory({
  postId,
  tenantSlug,
  versions,
  currentMarkdown,
  onReverted,
}: {
  postId: string;
  tenantSlug: string;
  versions: BlogPostVersionRecord[];
  /** Current draft markdown, used as the right-hand side of the diff. */
  currentMarkdown: string;
  onReverted?: () => void;
}) {
  const dialogs = useDialogs();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleRevert = async (versionId: string, versionNumber: number) => {
    const ok = await dialogs.confirm({
      title: `Revert to v${versionNumber}?`,
      subtitle:
        "Your current draft will be saved as a new version first, so nothing is lost.",
      tone: "warning",
      icon: Undo2,
      confirmLabel: "Revert",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await revertToVersion(postId, tenantSlug, versionId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setExpandedId(null);
      onReverted?.();
    });
  };

  if (versions.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg p-5 text-center">
        <History size={18} className="mx-auto text-text-muted mb-2" />
        <p className="text-text-muted text-xs">
          No history yet. Each save creates a version.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
        <h3 className="text-foreground font-semibold text-sm">
          Version history
        </h3>
        <span className="text-[10px] text-text-muted">
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="divide-y divide-border/30">
        {versions.map((v) => {
          const isExpanded = expandedId === v.id;
          return (
            <li key={v.id} className="p-3 text-xs">
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : v.id)}
                className="w-full flex items-center gap-3 text-left"
              >
                <ChevronRight
                  size={14}
                  className={`text-text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
                <span className="font-mono text-text-muted w-10 shrink-0">
                  v{v.versionNumber}
                </span>
                <span className="flex-1 text-foreground truncate">
                  {v.diffSummary ?? "(saved)"}
                </span>
                <span className="text-text-muted shrink-0">
                  {v.wordCount.toLocaleString()}w
                </span>
                {v.contentScore != null && (
                  <span
                    className={`shrink-0 ${
                      v.contentScore >= 80
                        ? "text-status-green"
                        : "text-status-yellow"
                    }`}
                  >
                    {v.contentScore}
                  </span>
                )}
                <span className="text-text-muted shrink-0">
                  {new Date(v.createdAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </button>

              {isExpanded && (
                <div className="mt-3 space-y-3 pl-7">
                  <DiffViewer
                    fromText={v.contentMarkdown}
                    toText={currentMarkdown}
                    fromLabel={`v${v.versionNumber}`}
                    toLabel="Current draft"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        handleRevert(v.id, v.versionNumber)
                      }
                      disabled={isPending}
                    >
                      <Undo2 size={13} />
                      Revert to v{v.versionNumber}
                    </Button>
                    <span className="text-[10px] text-text-muted inline-flex items-center gap-1">
                      <GitCompare size={10} />
                      diff vs current
                    </span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="px-4 py-2 text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
