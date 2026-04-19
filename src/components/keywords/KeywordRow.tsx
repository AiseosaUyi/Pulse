"use client";

import { useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  deleteKeywordRanking,
  updateKeywordPosition,
} from "@/lib/actions/keywords";
import { useDialogs } from "@/components/ui/Dialog";
import type { KeywordRanking } from "@/lib/types/seo";
import { KEYWORD_DIFFICULTY_LABELS } from "@/lib/types/seo";

export function KeywordRow({ kw }: { kw: KeywordRanking }) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();

  const handleUpdate = async () => {
    const raw = await dialogs.prompt({
      title: `Update rank for "${kw.keyword}"`,
      subtitle:
        "Enter the new Google position (1 = top result). Leave blank to clear.",
      icon: Pencil,
      defaultValue: kw.position ? String(kw.position) : "",
      placeholder: "e.g. 7",
      validate: (v) => {
        const trimmed = v.trim();
        if (trimmed === "") return null;
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
          return "Position must be a positive whole number.";
        }
        return null;
      },
    });
    if (raw === null) return;
    const trimmed = raw.trim();
    const pos = trimmed === "" ? null : Number(trimmed);
    startTransition(async () => {
      const res = await updateKeywordPosition(kw.id, pos);
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't update rank",
          subtitle: res.error,
          tone: "destructive",
        });
      }
    });
  };

  const handleDelete = async () => {
    const ok = await dialogs.confirm({
      title: `Delete "${kw.keyword}"?`,
      subtitle:
        "The keyword stops tracking immediately. Historical ranks are removed with it.",
      tone: "destructive",
      confirmLabel: "Delete keyword",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteKeywordRanking(kw.id);
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't delete keyword",
          subtitle: res.error,
          tone: "destructive",
        });
      }
    });
  };

  const pos = kw.position;
  const prev = kw.previousPosition;
  const change = pos !== null && prev !== null ? prev - pos : null;

  return (
    <tr className="border-b border-border/20 last:border-0 hover:bg-card-hover transition-colors">
      <td className="px-5 py-3">
        <div className="flex flex-col">
          <span className="text-foreground text-sm">{kw.keyword}</span>
          {kw.url && (
            <span className="text-text-muted text-xs mt-0.5 truncate max-w-[260px]">
              {kw.url}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        {pos === null ? (
          <span className="text-text-muted text-sm">—</span>
        ) : (
          <span
            className={`text-sm font-bold ${
              pos <= 3
                ? "text-status-green"
                : pos <= 10
                ? "text-status-yellow"
                : "text-text-secondary"
            }`}
          >
            #{pos}
          </span>
        )}
      </td>
      <td className="px-3 py-3 text-center">
        {change === null || change === 0 ? (
          <span className="text-text-muted text-xs">—</span>
        ) : change > 0 ? (
          <span className="text-xs text-status-green">↑{change}</span>
        ) : (
          <span className="text-xs text-status-red">↓{Math.abs(change)}</span>
        )}
      </td>
      <td className="px-3 py-3 text-center text-xs text-text-muted">
        {KEYWORD_DIFFICULTY_LABELS[kw.difficulty]}
      </td>
      <td className="px-3 py-3 text-sm text-text-secondary text-right">
        {kw.volume.toLocaleString()}
      </td>
      <td className="px-3 py-3 text-xs text-text-muted text-right whitespace-nowrap">
        {kw.lastChecked ?? "—"}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={handleUpdate}
            disabled={isPending}
            aria-label="Update position"
            className="p-1.5 rounded text-text-muted hover:text-foreground hover:bg-sidebar transition-colors"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            aria-label="Delete keyword"
            className="p-1.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}
