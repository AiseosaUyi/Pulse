"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface PriorityChipProps {
  priority: string | null;
  onChange?: (newPriority: string) => void | Promise<void>;
  editable?: boolean;
  className?: string;
}

const TONE_MAP: Record<string, string> = {
  A: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  B: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  C: "bg-sidebar text-text-muted border-border",
};

export function PriorityChip({
  priority,
  onChange,
  editable = false,
  className,
}: PriorityChipProps) {
  const [editing, setEditing] = useState(false);
  const current = (priority ?? "A").toUpperCase();

  if (editable && editing && onChange) {
    return (
      <select
        autoFocus
        value={current}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setEditing(false);
          onChange(e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
        className="text-[10px] font-semibold bg-card border border-primary-500/40 rounded px-1 py-0.5 text-foreground outline-none"
      >
        <option value="A">Priority A</option>
        <option value="B">Priority B</option>
        <option value="C">Priority C</option>
      </select>
    );
  }

  const tone = TONE_MAP[current] || TONE_MAP.C;

  if (editable && onChange) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className={cn(
          "inline-flex items-center justify-center font-bold text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border transition-opacity hover:opacity-80",
          tone,
          className
        )}
        title="Click to change priority"
      >
        {current}
      </button>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center font-bold text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
        tone,
        className
      )}
      title={`Priority ${current}`}
    >
      {current}
    </span>
  );
}
