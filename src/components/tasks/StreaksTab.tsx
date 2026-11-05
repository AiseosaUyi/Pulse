"use client";

import { useState, useTransition } from "react";
import {
  Flame,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/Toaster";
import type {
  PersonStreakGroup,
  StreakSquare,
  TaskOccurrence,
} from "@/lib/types/tasks";
import { excuseOccurrenceAction } from "@/lib/actions/tasks";

interface StreaksTabProps {
  groups: PersonStreakGroup[];
  breaches: TaskOccurrence[];
  isAdmin: boolean;
  onOpenTask?: (taskId: string) => void;
}

export function StreaksTab({
  groups,
  breaches,
  isAdmin,
  onOpenTask,
}: StreaksTabProps) {
  const [excusingOccId, setExcusingOccId] = useState<string | null>(null);
  const [excuseReason, setExcuseReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleExcuse = (occId: string) => {
    if (!excuseReason.trim()) {
      toast.error("Please enter a reason to excuse this missed task");
      return;
    }

    startTransition(async () => {
      const res = await excuseOccurrenceAction(occId, excuseReason.trim());
      if (!res.success) {
        toast.error(res.error ?? "Failed to excuse task");
      } else {
        toast.success("Breach excused");
        setExcusingOccId(null);
        setExcuseReason("");
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl border border-border bg-card text-xs">
        <span className="font-bold text-foreground">Legend:</span>
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-xs bg-emerald-500" />
          <span className="text-text-secondary">Done</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-xs bg-emerald-300 dark:bg-emerald-600" />
          <span className="text-text-secondary">Done late</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-xs bg-amber-400" />
          <span className="text-text-secondary">Below target</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-xs bg-rose-500" />
          <span className="text-text-secondary">Missed (breach)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-xs bg-gray-400 border border-dashed border-gray-600" />
          <span className="text-text-secondary">Excused</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-xs bg-card border border-border" />
          <span className="text-text-secondary">Skipped / Off</span>
        </div>
      </div>

      {/* Grid Rows Grouped by Person */}
      <div className="space-y-6">
        {groups.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-border bg-card text-center space-y-2">
            <Flame size={32} className="mx-auto text-amber-500/70" />
            <h3 className="text-sm font-semibold text-foreground">No recurring habits set up</h3>
            <p className="text-xs text-text-muted">
              Create recurring daily tasks to track streaks and accountability here.
            </p>
          </div>
        ) : (
          groups.map((grp) => (
            <div
              key={grp.person.id}
              className="rounded-2xl border border-border bg-card overflow-hidden"
            >
              <div className="px-5 py-3.5 border-b border-border bg-background flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">
                    {grp.person.name}
                  </span>
                  {grp.person.tags?.map((t) => (
                    <span key={t} className="text-[10px] text-text-muted bg-card px-2 py-0.5 rounded-full border border-border capitalize">
                      {t}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-text-muted font-medium">
                  {grp.tasks.length} habit{grp.tasks.length === 1 ? "" : "s"} tracked
                </span>
              </div>

              <div className="divide-y divide-border">
                {grp.tasks.map((row) => (
                  <div
                    key={row.task.id}
                    className="p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4"
                  >
                    {/* Task Title & Tags */}
                    <div className="min-w-[220px] max-w-xs">
                      <button
                        type="button"
                        onClick={() => onOpenTask?.(row.task.id)}
                        className="text-left font-bold text-foreground hover:text-primary-500 transition-colors text-sm line-clamp-1"
                      >
                        {row.task.title}
                      </button>
                      <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
                        <span className="capitalize">{row.task.recurrence}</span>
                        {row.task.tags.length > 0 && (
                          <span>• #{row.task.tags[0]}</span>
                        )}
                      </div>
                    </div>

                    {/* 30-Day GitHub-style Heatmap Grid */}
                    <div className="flex items-center gap-1 overflow-x-auto py-1">
                      {row.squares.map((sq, i) => (
                        <HeatmapSquare key={i} square={sq} />
                      ))}
                    </div>

                    {/* Stats Beside Grid */}
                    <div className="flex items-center gap-4 text-xs font-semibold shrink-0">
                      <div className="text-center w-16">
                        <span className="text-[10px] text-text-muted uppercase tracking-wider block">
                          Streak
                        </span>
                        <span className="text-foreground font-bold flex items-center justify-center gap-1">
                          <Flame
                            size={13}
                            className={
                              row.currentStreak > 0
                                ? "text-amber-500 fill-amber-500"
                                : "text-text-muted"
                            }
                          />
                          {row.currentStreak}
                        </span>
                      </div>

                      <div className="text-center w-16">
                        <span className="text-[10px] text-text-muted uppercase tracking-wider block">
                          Best
                        </span>
                        <span className="text-text-secondary">{row.longestStreak}</span>
                      </div>

                      <div className="text-center w-16">
                        <span className="text-[10px] text-text-muted uppercase tracking-wider block">
                          30d %
                        </span>
                        <span
                          className={`font-bold ${
                            row.completionRate30d >= 80
                              ? "text-success-500"
                              : row.completionRate30d >= 50
                              ? "text-warning-500"
                              : "text-error-500"
                          }`}
                        >
                          {row.completionRate30d}%
                        </span>
                      </div>

                      <div className="text-center w-20">
                        <span className="text-[10px] text-text-muted uppercase tracking-wider block">
                          Breaches
                        </span>
                        <span
                          className={`font-bold ${
                            row.breachesThisMonth > 0
                              ? "text-error-500"
                              : "text-text-muted"
                          }`}
                        >
                          {row.breachesThisMonth} this mo
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Breaches Section (The Record of Missed Days) */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-error-500 uppercase tracking-wider">
            <ShieldAlert size={16} />
            <span>Breaches Record (Missed Tasks)</span>
          </div>
          <span className="text-xs text-text-muted font-medium">
            {breaches.length} total missed occurrences
          </span>
        </div>

        {breaches.length === 0 ? (
          <div className="p-6 rounded-2xl border border-dashed border-border bg-card text-center space-y-1">
            <CheckCircle2 size={24} className="mx-auto text-success-500" />
            <p className="text-xs font-semibold text-foreground">Zero breaches on record</p>
            <p className="text-[11px] text-text-muted">
              Every scheduled task has been completed or excused.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-background text-text-muted uppercase tracking-wider font-semibold text-[10px]">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Owner</th>
                    <th className="px-4 py-3">Task</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {breaches.map((b) => (
                    <tr key={b.id} className="hover:bg-card-hover transition-colors">
                      <td className="px-4 py-3 font-mono text-error-500 font-semibold whitespace-nowrap">
                        {b.occursOn}
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground whitespace-nowrap">
                        {b.owner?.name ?? "Team member"}
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium">
                        {b.task?.title ?? "Task"}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isAdmin && (
                          excusingOccId === b.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <Input
                                value={excuseReason}
                                onChange={(e) => setExcuseReason(e.target.value)}
                                placeholder="Reason (e.g. sick leave, public holiday)..."
                                className="text-xs h-7 w-64"
                              />
                              <Button
                                size="sm"
                                onClick={() => handleExcuse(b.id)}
                                disabled={isPending}
                                className="h-7 text-xs"
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setExcusingOccId(null);
                                  setExcuseReason("");
                                }}
                                className="h-7 text-xs"
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setExcusingOccId(b.id)}
                              className="h-7 text-xs text-text-secondary hover:text-foreground"
                            >
                              Excuse Miss
                            </Button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Single Heatmap Square with Native Tooltip
// ─────────────────────────────────────────────────────────────────────────────

function HeatmapSquare({ square }: { square: StreakSquare }) {
  let bgClass = "bg-card border border-border";
  let statusLabel = "Not scheduled / skipped";

  if (square.status === "done") {
    if (square.completedLate) {
      bgClass = "bg-emerald-300 dark:bg-emerald-600";
      statusLabel = "Completed late";
    } else if (square.belowTarget) {
      bgClass = "bg-amber-400";
      statusLabel = `Done below target (${square.metricValue} of ${square.metricTarget} ${square.metricLabel ?? ""})`;
    } else {
      bgClass = "bg-emerald-500";
      statusLabel = "Completed";
    }
  } else if (square.status === "missed") {
    bgClass = "bg-rose-500 shadow-xs";
    statusLabel = "Missed (breach)";
  } else if (square.status === "excused") {
    bgClass = "bg-gray-400 border border-dashed border-gray-600";
    statusLabel = "Excused by admin";
  } else if (square.status === "skipped") {
    bgClass = "bg-card border border-border/60";
    statusLabel = "Skipped (leave / paused)";
  }

  const tooltipLines = [
    `Date: ${square.date}`,
    `Status: ${statusLabel}`,
  ];
  if (square.metricValue !== null && square.metricValue !== undefined) {
    tooltipLines.push(`Value: ${square.metricValue} ${square.metricLabel ?? ""}`);
  }
  if (square.proofUrl) {
    tooltipLines.push(`Proof: ${square.proofUrl}`);
  }
  if (square.proofNote) {
    tooltipLines.push(`Note: ${square.proofNote}`);
  }

  return (
    <div
      title={tooltipLines.join("\n")}
      className={`w-3.5 h-3.5 rounded-xs shrink-0 cursor-pointer transition-transform hover:scale-125 hover:z-10 ${bgClass}`}
    />
  );
}
