"use client";

import { useState, useTransition } from "react";
import {
  Flame,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RotateCcw,
  Upload,
  Link as LinkIcon,
  FileText,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/Toaster";
import type { TaskOccurrence, TeamPerson } from "@/lib/types/tasks";
import {
  completeOccurrenceAction,
  uncompleteOccurrenceAction,
  toggleCheckAction,
  getSignedProofUploadUrlAction,
} from "@/lib/actions/tasks";

interface TodayTabProps {
  overdueOccurrences: TaskOccurrence[];
  todayOccurrences: TaskOccurrence[];
  people: TeamPerson[];
  isAdmin: boolean;
  currentUserId: string;
  selectedPersonId: string; // 'me' | 'everyone' | personId
  onSelectPerson: (id: string) => void;
  onEditTask?: (occurrence: TaskOccurrence) => void;
  streaksByTaskId?: Record<string, number>;
}

export function TodayTab({
  overdueOccurrences,
  todayOccurrences,
  people,
  isAdmin,
  currentUserId,
  selectedPersonId,
  onSelectPerson,
  onEditTask,
  streaksByTaskId = {},
}: TodayTabProps) {
  const [showDoneToday, setShowDoneToday] = useState(false);

  // Filter based on selected person
  const myPerson = people.find((p) => p.userId === currentUserId);

  const filterOcc = (occ: TaskOccurrence) => {
    if (selectedPersonId === "everyone") return true;
    if (selectedPersonId === "me") {
      return myPerson ? occ.ownerPersonId === myPerson.id : true;
    }
    return occ.ownerPersonId === selectedPersonId;
  };

  const filteredOverdue = overdueOccurrences.filter(filterOcc);
  const filteredToday = todayOccurrences.filter(filterOcc);

  const pendingToday = filteredToday.filter((o) => o.status === "pending");
  const doneToday = filteredToday.filter((o) => o.status === "done" || o.status === "excused");

  return (
    <div className="space-y-6">
      {/* Person Switcher Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          type="button"
          onClick={() => onSelectPerson("me")}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            selectedPersonId === "me"
              ? "bg-primary-500 text-white shadow-xs"
              : "bg-card border border-border text-text-secondary hover:text-foreground"
          }`}
        >
          Me {myPerson ? `(${myPerson.name})` : ""}
        </button>

        <button
          type="button"
          onClick={() => onSelectPerson("everyone")}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            selectedPersonId === "everyone"
              ? "bg-primary-500 text-white shadow-xs"
              : "bg-card border border-border text-text-secondary hover:text-foreground"
          }`}
        >
          Everyone
        </button>

        <div className="h-4 w-px bg-border shrink-0 mx-1" />

        {people.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectPerson(p.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              selectedPersonId === p.id
                ? "bg-primary-500 text-white shadow-xs"
                : "bg-card border border-border text-text-secondary hover:text-foreground"
            }`}
          >
            <span>{p.name}</span>
            {!p.userId && (
              <span className="text-[10px] opacity-75">(ambassador)</span>
            )}
          </button>
        ))}
      </div>

      {/* 1. Overdue Section */}
      {filteredOverdue.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-error-500 uppercase tracking-wider">
            <AlertTriangle size={15} />
            <span>Overdue ({filteredOverdue.length})</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredOverdue.map((occ) => (
              <TaskCard
                key={occ.id}
                occurrence={occ}
                isOverdue
                streak={streaksByTaskId[occ.taskId] ?? 0}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onEdit={() => onEditTask?.(occ)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 2. Due Today Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
            <Clock size={15} className="text-primary-500" />
            <span>Due Today ({pendingToday.length})</span>
          </div>
        </div>

        {pendingToday.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-border bg-card text-center space-y-2">
            <CheckCircle2 size={32} className="mx-auto text-success-500/80" />
            <h3 className="text-sm font-semibold text-foreground">Nothing due today</h3>
            <p className="text-xs text-text-muted max-w-sm mx-auto">
              All tasks for this view have been completed or excused. Keep the streak going!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingToday.map((occ) => (
              <TaskCard
                key={occ.id}
                occurrence={occ}
                streak={streaksByTaskId[occ.taskId] ?? 0}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onEdit={() => onEditTask?.(occ)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 3. Done Today Section (Collapsed Accordion) */}
      {doneToday.length > 0 && (
        <div className="border border-border rounded-2xl bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDoneToday(!showDoneToday)}
            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-card-hover transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 size={16} className="text-success-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Done Today ({doneToday.length})
              </span>
            </div>
            <div className="flex items-center gap-2 text-text-muted text-xs">
              <span>{showDoneToday ? "Hide" : "Show"}</span>
              {showDoneToday ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
          </button>

          {showDoneToday && (
            <div className="p-5 pt-0 space-y-3 border-t border-border">
              {doneToday.map((occ) => (
                <DoneTaskRow
                  key={occ.id}
                  occurrence={occ}
                  isAdmin={isAdmin}
                  currentUserId={currentUserId}
                  onEdit={() => onEditTask?.(occ)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive Card for Due Today / Overdue Tasks
// ─────────────────────────────────────────────────────────────────────────────

interface TaskCardProps {
  occurrence: TaskOccurrence;
  isOverdue?: boolean;
  streak?: number;
  currentUserId: string;
  isAdmin: boolean;
  onEdit?: () => void;
}

function TaskCard({
  occurrence,
  isOverdue,
  streak = 0,
  currentUserId,
  isAdmin,
  onEdit,
}: TaskCardProps) {
  const task = occurrence.task;
  const [isPending, startTransition] = useTransition();

  // Inline completion fields
  const [proofUrl, setProofUrl] = useState(occurrence.proofUrl ?? "");
  const [proofNote, setProofNote] = useState(occurrence.proofNote ?? "");
  const [proofImagePath, setProofImagePath] = useState(occurrence.proofImagePath ?? "");
  const [metricValue, setMetricValue] = useState<string>(
    occurrence.metricValue !== null && occurrence.metricValue !== undefined
      ? String(occurrence.metricValue)
      : ""
  );

  const [isUploading, setIsUploading] = useState(false);

  // Checklist checks
  const checks = occurrence.checks ?? [];
  const checkedCount = checks.filter((c) => c.checked).length;
  const allChecksDone = checks.length === 0 || checkedCount === checks.length;

  // Proof validation
  const proofReq = task?.proofRequired ?? "none";
  let isProofSatisfied = true;
  if (proofReq === "link") {
    isProofSatisfied = proofUrl.startsWith("http://") || proofUrl.startsWith("https://");
  } else if (proofReq === "note") {
    isProofSatisfied = proofNote.trim().length > 0;
  } else if (proofReq === "image") {
    isProofSatisfied = proofImagePath.trim().length > 0;
  }

  const canPressDone = allChecksDone && isProofSatisfied && !isPending;

  // Toggle check item
  const handleToggleCheck = (checkId: string, currentChecked: boolean) => {
    startTransition(async () => {
      await toggleCheckAction(checkId, !currentChecked);
    });
  };

  // Image Upload
  const handleImageUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File is larger than 5 MB limit");
      return;
    }
    setIsUploading(true);
    try {
      const res = await getSignedProofUploadUrlAction(file.name);
      if (!res.success || !res.uploadUrl || !res.path) {
        toast.error(res.error ?? "Could not generate upload URL");
        return;
      }

      const uploadRes = await fetch(res.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        toast.error("Failed to upload image to storage");
        return;
      }

      setProofImagePath(res.path);
      toast.success("Image proof uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  // Done button
  const handleComplete = () => {
    if (!canPressDone) return;

    startTransition(async () => {
      const parsedMetric = metricValue.trim() ? Number(metricValue) : null;
      const res = await completeOccurrenceAction({
        occurrenceId: occurrence.id,
        proofUrl: proofReq === "link" ? proofUrl : null,
        proofNote: proofReq === "note" ? proofNote : null,
        proofImagePath: proofReq === "image" ? proofImagePath : null,
        metricValue: parsedMetric,
      });

      if (!res.success) {
        toast.error(res.error ?? "Failed to complete task");
      } else {
        toast.success("Task completed! 🎉");
      }
    });
  };

  const priorityColors: Record<string, string> = {
    urgent: "bg-error-500/10 text-error-500 border-error-500/20",
    high: "bg-warning-50 text-warning-500 border-warning-500/20",
    normal: "bg-primary-50 text-primary-500 border-primary-500/20",
    low: "bg-gray-100 dark:bg-gray-800 text-text-muted border-border",
  };

  // Check if created today late
  const isCreatedLate =
    occurrence.task &&
    occurrence.task.createdAt.slice(0, 10) === occurrence.occursOn &&
    new Date(occurrence.task.createdAt).getHours() >= 18;

  return (
    <div
      className={`rounded-2xl border p-5 bg-card flex flex-col justify-between transition-all ${
        isOverdue ? "border-error-500/40 shadow-xs" : "border-border hover:border-border-hover"
      }`}
    >
      <div className="space-y-3">
        {/* Top Badges & Priority */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                priorityColors[task?.priority ?? "normal"]
              }`}
            >
              {task?.priority ?? "normal"}
            </span>

            {task?.kind === "recurring" && streak > 0 && (
              <span className="text-[11px] font-bold text-amber-500 flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                <Flame size={12} className="fill-amber-500" />
                {streak}
              </span>
            )}

            {isCreatedLate && (
              <span className="text-[10px] font-semibold text-warning-600 bg-warning-50 px-2 py-0.5 rounded-full border border-warning-500/20">
                Created late
              </span>
            )}

            {isOverdue && (
              <span className="text-[10px] font-bold text-error-500 bg-error-500/10 px-2 py-0.5 rounded-full border border-error-500/20">
                Due {occurrence.occursOn}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-text-muted hover:text-foreground font-medium hover:underline"
          >
            Edit
          </button>
        </div>

        {/* Task Title & Owner */}
        <div>
          <h3 className="text-base font-bold text-foreground leading-snug">
            {task?.title ?? "Untitled task"}
          </h3>
          <div className="flex items-center gap-2 text-xs text-text-muted mt-1">
            <span>Owner: <strong className="text-foreground">{occurrence.owner?.name ?? "Team member"}</strong></span>
            {task?.dueTime && (
              <>
                <span>•</span>
                <span>By {task.dueTime.slice(0, 5)}</span>
              </>
            )}
          </div>
        </div>

        {/* Description snippet if any */}
        {task?.description && (
          <p className="text-xs text-text-secondary line-clamp-2">
            {task.description}
          </p>
        )}

        {/* Checklist Items */}
        {checks.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
                Checklist
              </span>
              <span>
                {checkedCount} of {checks.length}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all duration-300"
                style={{ width: `${(checkedCount / checks.length) * 100}%` }}
              />
            </div>

            <div className="space-y-1.5 pt-1">
              {checks.map((chk) => (
                <label
                  key={chk.id}
                  className="flex items-start gap-2 text-xs text-foreground cursor-pointer group select-none"
                >
                  <input
                    type="checkbox"
                    checked={chk.checked}
                    onChange={() => handleToggleCheck(chk.id, chk.checked)}
                    className="mt-0.5 rounded-sm border-border accent-primary-500 cursor-pointer"
                  />
                  <span
                    className={`flex-1 font-medium ${
                      chk.checked ? "line-through text-text-muted" : "text-foreground"
                    }`}
                  >
                    {chk.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Proof Field Inline */}
        {proofReq !== "none" && (
          <div className="pt-2 border-t border-border space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground uppercase tracking-wider text-[10px] flex items-center gap-1">
                {proofReq === "link" && <LinkIcon size={12} />}
                {proofReq === "note" && <FileText size={12} />}
                {proofReq === "image" && <Upload size={12} />}
                Proof Required ({proofReq})
              </span>
              {task?.proofHint && (
                <span className="text-[10px] text-text-muted italic">{task.proofHint}</span>
              )}
            </div>

            {proofReq === "link" && (
              <Input
                type="url"
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                placeholder="https://..."
                className="text-xs h-8"
              />
            )}

            {proofReq === "note" && (
              <Input
                type="text"
                value={proofNote}
                onChange={(e) => setProofNote(e.target.value)}
                placeholder="Who did you reply to / outcome..."
                className="text-xs h-8"
              />
            )}

            {proofReq === "image" && (
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImageUpload(f);
                  }}
                  className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-600 hover:file:bg-primary-100"
                />
                {isUploading && <span className="text-xs text-text-muted">Uploading...</span>}
                {proofImagePath && (
                  <span className="text-xs text-success-500 font-medium">✓ Uploaded</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Metric Value Inline */}
        {task?.metricLabel && (
          <div className="pt-2 border-t border-border flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-foreground text-[11px]">
              {task.metricLabel}
              {task.metricTarget ? ` (target: ${task.metricTarget})` : ""}:
            </span>
            <Input
              type="number"
              value={metricValue}
              onChange={(e) => setMetricValue(e.target.value)}
              placeholder="0"
              className="w-24 text-xs h-8 text-right font-bold"
            />
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="pt-4 mt-3 border-t border-border flex items-center justify-end">
        <Button
          onClick={handleComplete}
          disabled={!canPressDone}
          className="w-full sm:w-auto px-6 h-9 font-semibold text-xs"
        >
          {isPending ? "Completing..." : "Done ✓"}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Done Task Accordion Row
// ─────────────────────────────────────────────────────────────────────────────

interface DoneTaskRowProps {
  occurrence: TaskOccurrence;
  isAdmin: boolean;
  currentUserId: string;
  onEdit?: () => void;
}

function DoneTaskRow({ occurrence, isAdmin, currentUserId, onEdit }: DoneTaskRowProps) {
  const task = occurrence.task;
  const [isPending, startTransition] = useTransition();

  const handleUndo = () => {
    startTransition(async () => {
      const res = await uncompleteOccurrenceAction(occurrence.id);
      if (!res.success) {
        toast.error(res.error ?? "Failed to uncomplete task");
      } else {
        toast.success("Task uncompleted");
      }
    });
  };

  const completedTime = occurrence.completedAt
    ? new Date(occurrence.completedAt).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const completedByWho = occurrence.completedByProfile?.displayName ?? "User";

  const isBelowTarget =
    task?.metricTarget !== null &&
    occurrence.metricValue !== null &&
    occurrence.metricValue !== undefined &&
    task?.metricTarget !== undefined &&
    occurrence.metricValue < task.metricTarget;

  return (
    <div className="p-3.5 rounded-xl border border-border bg-background flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-foreground text-sm line-through opacity-85">
            {task?.title ?? "Task"}
          </span>
          {occurrence.completedLate && (
            <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              Late
            </span>
          )}
          {isBelowTarget && (
            <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              {occurrence.metricValue} of {task?.metricTarget} {task?.metricLabel}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-text-muted text-[11px] flex-wrap">
          <span>Owner: <strong className="text-foreground">{occurrence.owner?.name}</strong></span>
          <span>•</span>
          <span>Completed at {completedTime} by <strong className="text-foreground">{completedByWho}</strong></span>
          {occurrence.proofUrl && (
            <>
              <span>•</span>
              <a
                href={occurrence.proofUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary-500 hover:underline flex items-center gap-1 font-medium"
              >
                Proof link <ExternalLink size={11} />
              </a>
            </>
          )}
          {occurrence.proofNote && (
            <>
              <span>•</span>
              <span className="italic">&ldquo;{occurrence.proofNote}&rdquo;</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleUndo}
          disabled={isPending}
          className="h-7 text-xs flex items-center gap-1.5"
        >
          <RotateCcw size={12} />
          Undo
        </Button>
      </div>
    </div>
  );
}
