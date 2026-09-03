"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QueueGroup as QueueGroupData } from "@/lib/services/action-queue";
import { QueueRowCard } from "./QueueRowCard";
import type { TenantMemberSummary } from "@/lib/services/team";

export function QueueGroup({
  group,
  currentUserId,
  members,
  onChanged,
  defaultOpen = true,
}: {
  group: QueueGroupData;
  currentUserId: string;
  members: TenantMemberSummary[];
  onChanged: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (group.count === 0) return null;

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2.5 px-1 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{group.label}</span>
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-border/50 text-text-secondary">
            {group.count}
          </span>
        </span>
        <ChevronDown size={16} className={cn("text-text-muted transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="pb-3 space-y-2">
          {group.rows.map((row) => (
            <QueueRowCard
              key={`${row.source}:${row.id}`}
              row={row}
              currentUserId={currentUserId}
              members={members}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}
