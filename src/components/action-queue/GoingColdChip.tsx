"use client";

import { ExternalLink } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";
import type { QueueRow } from "@/lib/services/action-queue";

// Going Cold: 20 names, not 20 essays — but a bare name + day-count alone
// didn't say why a prospect was worth a final attempt, so this carries one
// line of real context (why/body, whichever the row has) rather than
// turning back into a full card.
export function GoingColdChip({
  row,
  selected,
  onToggle,
  onOpen,
}: {
  row: QueueRow;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const context = row.why ?? row.body;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-2 py-1.5 text-xs",
        selected ? "border-primary-500 bg-primary-50" : "border-border/50 hover:border-border"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex items-start gap-2 min-w-0 flex-1 text-left"
        aria-pressed={selected}
      >
        <span
          className={cn(
            "mt-0.5 shrink-0 h-3.5 w-3.5 rounded border flex items-center justify-center",
            selected ? "bg-primary-500 border-primary-500" : "border-border"
          )}
          aria-hidden
        >
          {selected && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
        </span>
        <Avatar url={null} name={row.fromName ?? row.title} size="sm" className="w-6 h-6 text-[10px] mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-foreground font-medium">{row.fromName ?? row.title}</span>
            <span className="shrink-0 text-text-muted" suppressHydrationWarning>
              {formatRelativeTime(row.receivedAt)}
            </span>
          </div>
          {context && <p className="mt-0.5 truncate text-text-muted">{context}</p>}
        </div>
      </button>
      {row.externalUrl && (
        <a
          href={row.externalUrl}
          target="_blank"
          rel="noreferrer"
          onClick={onOpen}
          aria-label="Open profile"
          className="shrink-0 mt-0.5 text-text-muted hover:text-primary-500"
        >
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}
