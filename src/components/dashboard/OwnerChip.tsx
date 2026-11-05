"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamPerson } from "@/lib/types/tasks";
import { usePeople } from "@/lib/hooks/usePeople";

interface OwnerChipProps {
  owner: string | null;
  ownerPersonId?: string | null;
  people?: TeamPerson[];
  onChange?: (newOwner: string | null, personId?: string | null) => void | Promise<void>;
  editable?: boolean;
  className?: string;
  compact?: boolean;
}

export function OwnerChip({
  owner,
  ownerPersonId,
  people: propPeople,
  onChange,
  editable = true,
  className,
  compact = false,
}: OwnerChipProps) {
  const [editing, setEditing] = useState(false);
  const hookPeople = usePeople();
  const people = propPeople || hookPeople.activePeople;

  // Resolve display name
  let displayOwner = "Unassigned";
  if (ownerPersonId) {
    const p = people.find((item) => item.id === ownerPersonId);
    if (p) displayOwner = p.name;
    else if (owner && owner.trim()) displayOwner = owner.trim();
  } else if (owner && owner.trim() && owner.toLowerCase() !== "unassigned") {
    displayOwner = owner.trim();
  }

  const isUnassigned = displayOwner === "Unassigned";

  if (editable && editing && onChange) {
    return (
      <select
        autoFocus
        value={ownerPersonId || ""}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setEditing(false);
          const val = e.target.value.trim();
          if (val === "" || val === "unassigned") {
            onChange(null, null);
          } else {
            const p = people.find((item) => item.id === val);
            onChange(p?.name ?? null, p?.id ?? null);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="text-[11px] font-medium bg-card border border-primary-500/40 rounded px-1.5 py-0.5 text-foreground outline-hidden shadow-xs"
      >
        <option value="">Unassigned</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} {p.tags?.includes("ambassador") ? "(Ambassador)" : ""}
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
          "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border/60 bg-card hover:border-primary-500/40 hover:bg-card-hover transition-colors shrink-0 cursor-pointer",
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
