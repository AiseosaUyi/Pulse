"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_TEAM_MEMBERS = [
  "Aise",
  "Abas",
  "Abdul",
  "Olamide",
  "Ambassador 1",
  "Ambassador 2",
];

interface OwnerChipProps {
  owner: string | null;
  teamMembers?: string[];
  onChange?: (newOwner: string | null) => void | Promise<void>;
  editable?: boolean;
  className?: string;
  compact?: boolean;
}

export function OwnerChip({
  owner,
  teamMembers = DEFAULT_TEAM_MEMBERS,
  onChange,
  editable = true,
  className,
  compact = false,
}: OwnerChipProps) {
  const [editing, setEditing] = useState(false);
  const displayOwner = owner?.trim() || "Unassigned";
  const isUnassigned = !owner || owner.trim() === "" || owner.toLowerCase() === "unassigned";

  // Build clean unique list including current owner if not in standard list
  const memberList = Array.from(
    new Set([...teamMembers, ...(owner && !isUnassigned ? [owner] : [])])
  );

  if (editable && editing && onChange) {
    return (
      <select
        autoFocus
        value={isUnassigned ? "" : owner}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setEditing(false);
          const val = e.target.value.trim();
          onChange(val === "" ? null : val);
        }}
        onClick={(e) => e.stopPropagation()}
        className="text-[11px] font-medium bg-card border border-primary-500/40 rounded px-1.5 py-0.5 text-foreground outline-none shadow-sm"
      >
        <option value="">Unassigned</option>
        {memberList.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    );
  }

  const content = (
    <>
      <UserRound size={11} className={isUnassigned ? "text-text-muted/60" : "text-primary-500"} />
      <span className={cn("truncate max-w-[120px]", isUnassigned ? "text-text-muted" : "text-foreground font-medium")}>
        {displayOwner}
      </span>
    </>
  );

  if (editable && onChange) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border/60 bg-card hover:border-primary-500/40 hover:bg-card-hover transition-colors shrink-0",
          compact && "px-1.5 py-0 text-[10px]",
          className
        )}
        title="Click to assign owner"
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border/40 bg-sidebar/50 shrink-0",
        compact && "px-1.5 py-0 text-[10px]",
        className
      )}
    >
      {content}
    </span>
  );
}
