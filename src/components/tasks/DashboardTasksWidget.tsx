"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, ArrowRight, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import type { TaskOccurrence } from "@/lib/types/tasks";
import { completeOccurrenceAction } from "@/lib/actions/tasks";

interface DashboardTasksWidgetProps {
  occurrences: TaskOccurrence[];
  tenantSlug: string;
}

export function DashboardTasksWidget({ occurrences, tenantSlug }: DashboardTasksWidgetProps) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const pending = occurrences.filter((o) => o.status === "pending" && !completedIds.has(o.id));

  if (pending.length === 0) return null;

  const handleQuickComplete = (occ: TaskOccurrence) => {
    // If proof or checklist is required, guide user to /tasks to complete with proof
    const proofReq = occ.task?.proofRequired ?? "none";
    const hasChecks = (occ.checks ?? []).length > 0;

    if (proofReq !== "none" || hasChecks) {
      window.location.href = `/tasks?tab=today`;
      return;
    }

    startTransition(async () => {
      const res = await completeOccurrenceAction({ occurrenceId: occ.id });
      if (!res.success) {
        toast.error(res.error ?? "Failed to complete task");
      } else {
        toast.success(`Done! ${occ.task?.title}`);
        setCompletedIds(new Set([...completedIds, occ.id]));
      }
    });
  };

  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-primary-500" />
          <h2 className="text-sm font-semibold text-foreground">
            Tasks due today ({pending.length})
          </h2>
        </div>
        <Link href="/tasks" className="text-xs text-primary-500 hover:underline flex items-center gap-1 font-medium">
          View all tasks <ArrowRight size={12} />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
        {pending.slice(0, 3).map((occ) => (
          <div
            key={occ.id}
            className="p-3.5 rounded-xl border border-border bg-background flex flex-col justify-between gap-3 text-xs"
          >
            <div>
              <div className="flex items-center justify-between text-text-muted text-[10px] mb-1">
                <span>{occ.owner?.name}</span>
                {occ.task?.dueTime && <span>By {occ.task.dueTime.slice(0, 5)}</span>}
              </div>
              <h4 className="font-bold text-foreground line-clamp-2">
                {occ.task?.title}
              </h4>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-[10px] text-text-muted">
                {occ.task?.proofRequired !== "none" ? `Needs ${occ.task?.proofRequired}` : "Quick tick"}
              </span>

              <Button
                size="sm"
                variant="outline"
                onClick={() => handleQuickComplete(occ)}
                disabled={isPending}
                className="h-7 px-3 text-xs"
              >
                Done ✓
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
