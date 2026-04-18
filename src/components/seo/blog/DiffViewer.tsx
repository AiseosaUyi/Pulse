// Word-level diff for blog markdown. `diff.diffWords` keeps line
// structure readable while catching phrase-level edits the user
// actually cares about — line-diff is too coarse for prose.

import { diffWords } from "diff";
import { useMemo } from "react";

interface Props {
  /** The older version (shown as "red"). */
  fromText: string;
  /** The newer version (shown as "green"). */
  toText: string;
  fromLabel?: string;
  toLabel?: string;
}

export function DiffViewer({
  fromText,
  toText,
  fromLabel = "Before",
  toLabel = "After",
}: Props) {
  const parts = useMemo(() => diffWords(fromText, toText), [fromText, toText]);

  const addedWords = parts.reduce(
    (n, p) => n + (p.added ? p.value.trim().split(/\s+/).length : 0),
    0
  );
  const removedWords = parts.reduce(
    (n, p) => n + (p.removed ? p.value.trim().split(/\s+/).length : 0),
    0
  );

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border/30 bg-sidebar/40 text-[11px]">
        <span className="text-text-muted">
          <span className="text-status-red mr-1">−</span>
          {fromLabel}
          {" · "}
          <span className="text-status-green mx-1">+</span>
          {toLabel}
        </span>
        <span className="text-text-muted">
          <span className="text-status-green">+{addedWords}</span>{" "}
          <span className="text-status-red">−{removedWords}</span>
        </span>
      </div>
      <pre className="p-4 text-xs leading-relaxed whitespace-pre-wrap font-mono max-h-[420px] overflow-y-auto">
        {parts.map((part, i) => {
          if (part.added) {
            return (
              <span
                key={i}
                className="bg-status-green/15 text-status-green rounded-sm px-0.5"
              >
                {part.value}
              </span>
            );
          }
          if (part.removed) {
            return (
              <span
                key={i}
                className="bg-status-red/15 text-status-red line-through rounded-sm px-0.5"
              >
                {part.value}
              </span>
            );
          }
          return (
            <span key={i} className="text-text-secondary">
              {part.value}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
