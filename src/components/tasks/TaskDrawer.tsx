"use client";

import { useState, useTransition } from "react";
import {
  X,
  Trash2,
  ChevronUp,
  ChevronDown,
  Pause,
  Play,
  Archive,
  History,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/Toaster";
import type {
  CreateTaskInput,
  ProofRequired,
  Task,
  TaskComment,
  TaskEvent,
  TaskKind,
  TaskPriority,
  TaskRecurrence,
  TeamPerson,
  UpdateTaskInput,
} from "@/lib/types/tasks";
import {
  createTaskAction,
  updateTaskAction,
  archiveTaskAction,
  addCommentAction,
  createTeamPersonAction,
} from "@/lib/actions/tasks";
import { AssigneePicker } from "@/components/shared/AssigneePicker";

const WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 7, label: "Sun" },
];

interface TaskDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  task?: Task | null;
  people: TeamPerson[];
  isAdmin: boolean;
  currentUserId?: string;
  defaultPersonId?: string;
  onTaskSaved?: (task: Task) => void;
}

export function TaskDrawer(props: TaskDrawerProps) {
  if (!props.isOpen) return null;

  return (
    <TaskDrawerForm
      key={props.task?.id ? `task-${props.task.id}` : `new-${props.defaultPersonId ?? "none"}`}
      {...props}
    />
  );
}

function TaskDrawerForm({
  onClose,
  task,
  people,
  isAdmin,
  currentUserId,
  defaultPersonId,
  onTaskSaved,
}: TaskDrawerProps) {
  const [activeTab, setActiveTab] = useState<"edit" | "history">("edit");
  const [isPending, startTransition] = useTransition();

  const today = new Date().toISOString().slice(0, 10);
  const initialOwner = task
    ? (task.ownerPersonId ?? "")
    : (defaultPersonId || people.find((p) => p.userId === currentUserId)?.id || people[0]?.id || "");

  // Form states initialized directly from props
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [ownerPersonId, setOwnerPersonId] = useState(initialOwner);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "normal");
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? "recurring");
  const [startDate, setStartDate] = useState(task?.startDate ?? today);
  const [endDate, setEndDate] = useState(task?.endDate ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? today);
  const [dueTime, setDueTime] = useState(task?.dueTime ? task.dueTime.slice(0, 5) : "");
  const [recurrence, setRecurrence] = useState<TaskRecurrence>(task?.recurrence ?? "daily");
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>(task?.recurrenceDays ?? [1, 2, 3, 4, 5]);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState<number>(task?.recurrenceMonthDay ?? 1);
  const [proofRequired, setProofRequired] = useState<ProofRequired>(task?.proofRequired ?? "none");
  const [proofHint, setProofHint] = useState(task?.proofHint ?? "");
  const [metricLabel, setMetricLabel] = useState(task?.metricLabel ?? "");
  const [metricTarget, setMetricTarget] = useState<string>(
    task?.metricTarget !== null && task?.metricTarget !== undefined ? String(task?.metricTarget) : ""
  );
  const [tags, setTags] = useState<string[]>(task?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [checklist, setChecklist] = useState<string[]>(
    task?.checklist ? task.checklist.map((c) => c.label) : []
  );
  const [newCheckItem, setNewCheckItem] = useState("");

  // Quick add person state
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");

  // History & Comments
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const loadHistory = () => {
    if (!task?.id || historyLoaded) return;
    fetch(`/api/v1/tasks/${task.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setEvents(data.events ?? []);
          setComments(data.comments ?? []);
          setHistoryLoaded(true);
        }
      })
      .catch(() => {});
  };

  const handleSave = () => {
    if (!title.trim()) {
      toast.error("Task title is required");
      return;
    }
    if (kind === "recurring" && !ownerPersonId) {
      toast.error("Recurring tasks must have an assigned owner (or be one-off)");
      return;
    }
    if (!startDate) {
      toast.error("Start date is required");
      return;
    }

    startTransition(async () => {
      const parsedTarget = metricTarget.trim() ? Number(metricTarget) : null;

      if (task) {
        // Update
        const patch: UpdateTaskInput = {
          title: title.trim(),
          description: description.trim() || null,
          ownerPersonId: ownerPersonId || null,
          priority,
          kind,
          startDate,
          endDate: endDate || null,
          dueDate: kind === "one_off" ? dueDate || null : null,
          dueTime: dueTime ? (dueTime.length === 5 ? `${dueTime}:00` : dueTime) : null,
          recurrence: kind === "recurring" ? recurrence : null,
          recurrenceDays: kind === "recurring" && recurrence === "weekly" ? recurrenceDays : null,
          recurrenceMonthDay: kind === "recurring" && recurrence === "monthly" ? recurrenceMonthDay : null,
          proofRequired,
          proofHint: proofHint.trim() || null,
          metricLabel: metricLabel.trim() || null,
          metricTarget: parsedTarget,
          tags,
          checklist,
        };

        const res = await updateTaskAction(task.id, patch);
        if (res.success && res.task) {
          toast.success("Task updated");
          onTaskSaved?.(res.task);
          onClose();
        } else {
          toast.error("Failed to update task", res.error);
        }
      } else {
        // Create
        const input: CreateTaskInput = {
          title: title.trim(),
          description: description.trim() || null,
          ownerPersonId: ownerPersonId || null,
          priority,
          kind,
          startDate,
          endDate: endDate || null,
          dueDate: kind === "one_off" ? dueDate || null : null,
          dueTime: dueTime ? (dueTime.length === 5 ? `${dueTime}:00` : dueTime) : null,
          recurrence: kind === "recurring" ? recurrence : null,
          recurrenceDays: kind === "recurring" && recurrence === "weekly" ? recurrenceDays : null,
          recurrenceMonthDay: kind === "recurring" && recurrence === "monthly" ? recurrenceMonthDay : null,
          proofRequired,
          proofHint: proofHint.trim() || null,
          metricLabel: metricLabel.trim() || null,
          metricTarget: parsedTarget,
          tags,
          checklist,
        };

        const res = await createTaskAction(input);
        if (res.success && res.task) {
          toast.success("Task created");
          onTaskSaved?.(res.task);
          onClose();
        } else {
          toast.error("Failed to create task", res.error);
        }
      }
    });
  };

  const handleTogglePause = () => {
    if (!task) return;
    const nextStatus = task.status === "paused" ? "active" : "paused";
    startTransition(async () => {
      const res = await updateTaskAction(task.id, { status: nextStatus });
      if (res.success && res.task) {
        toast.success(nextStatus === "active" ? "Task resumed" : "Task paused");
        onTaskSaved?.(res.task);
        onClose();
      } else {
        toast.error("Failed to change status", res.error);
      }
    });
  };

  const handleArchive = () => {
    if (!task) return;
    if (!confirm("Archive this task? Pending future occurrences will be removed.")) return;

    startTransition(async () => {
      const res = await archiveTaskAction(task.id);
      if (res.success) {
        toast.success("Task archived");
        onTaskSaved?.({ ...task, status: "archived" });
        onClose();
      } else {
        toast.error("Failed to archive task", res.error);
      }
    });
  };

  const handleAddPerson = () => {
    if (!newPersonName.trim()) return;
    startTransition(async () => {
      const res = await createTeamPersonAction({ name: newPersonName.trim() });
      if (res.success && res.person) {
        setOwnerPersonId(res.person.id);
        setShowAddPerson(false);
        setNewPersonName("");
        toast.success(`Added ${res.person.name}`);
      } else {
        toast.error("Failed to add person", res.error);
      }
    });
  };

  const handleAddComment = () => {
    if (!task?.id || !newComment.trim()) return;
    startTransition(async () => {
      const res = await addCommentAction(task.id, newComment.trim());
      if (res.success && res.comment) {
        setComments((prev) => [res.comment!, ...prev]);
        setNewComment("");
        toast.success("Comment added");
      } else {
        toast.error("Failed to add comment", res.error);
      }
    });
  };

  const toggleDay = (d: number) => {
    if (recurrenceDays.includes(d)) {
      if (recurrenceDays.length > 1) {
        setRecurrenceDays(recurrenceDays.filter((x) => x !== d));
      } else {
        toast.error("Weekly tasks need at least one day selected");
      }
    } else {
      setRecurrenceDays([...recurrenceDays, d].sort());
    }
  };

  const addCheckItem = () => {
    if (!newCheckItem.trim()) return;
    setChecklist([...checklist, newCheckItem.trim()]);
    setNewCheckItem("");
  };

  const removeCheckItem = (idx: number) => {
    setChecklist(checklist.filter((_, i) => i !== idx));
  };

  const moveCheckItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= checklist.length) return;
    const copy = [...checklist];
    const temp = copy[idx];
    copy[idx] = copy[target];
    copy[target] = temp;
    setChecklist(copy);
  };

  const addTag = () => {
    const clean = tagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!clean) return;
    if (!tags.includes(clean)) {
      setTags([...tags, clean]);
    }
    setTagInput("");
  };

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t));
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-background/80 backdrop-blur-xs animate-in fade-in-0">
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-2xl bg-card border-l border-border shadow-2xl flex flex-col">
          {/* Header */}
          <div className="px-6 py-5 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-base font-bold text-foreground">
                {task ? "Edit Task" : "New Task"}
              </span>
              {task && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    task.status === "active"
                      ? "bg-primary-500/10 text-primary-500"
                      : task.status === "paused"
                      ? "bg-status-yellow/10 text-status-yellow"
                      : "bg-muted text-text-muted"
                  }`}
                >
                  {task.status}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {task && (
                <div className="flex items-center bg-muted p-0.5 rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setActiveTab("edit")}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      activeTab === "edit"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-text-muted hover:text-foreground"
                    }`}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("history");
                      loadHistory();
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      activeTab === "history"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-text-muted hover:text-foreground"
                    }`}
                  >
                    History & Activity
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg text-text-muted hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {activeTab === "edit" ? (
              <>
                {/* Title */}
                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1">
                    Task Title <span className="text-error-500">*</span>
                  </label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Daily post on Gruve Lagos"
                    className="text-base font-medium"
                    autoFocus
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1">
                    Description / Context
                  </label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What needs to be done, guidelines, or links..."
                    rows={2}
                  />
                </div>

                {/* Owner & Priority Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                        Assignee
                      </label>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setShowAddPerson(!showAddPerson)}
                          className="text-xs text-primary-500 hover:underline"
                        >
                          + Add person
                        </button>
                      )}
                    </div>

                    {showAddPerson ? (
                      <div className="flex gap-2">
                        <Input
                          value={newPersonName}
                          onChange={(e) => setNewPersonName(e.target.value)}
                          placeholder="Person name"
                          className="text-sm"
                        />
                        <Button size="sm" onClick={handleAddPerson}>
                          Add
                        </Button>
                      </div>
                    ) : (
                      <AssigneePicker
                        mode="assign"
                        value={ownerPersonId || null}
                        onChange={(val) => setOwnerPersonId(val === "unassigned" ? "" : val)}
                        people={people}
                        disabled={!!task && !isAdmin}
                        className="w-full"
                      />
                    )}
                    {!!task && !isAdmin && (
                      <p className="text-[11px] text-text-muted mt-1">
                        Only admins can reassign tasks
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1">
                      Priority
                    </label>
                    <select
                      value={priority}
                      disabled={!!task && !isAdmin}
                      onChange={(e) => setPriority(e.target.value as TaskPriority)}
                      className="w-full h-10 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                    >
                      <option value="urgent">Urgent</option>
                      <option value="high">High</option>
                      <option value="normal">Normal</option>
                      <option value="low">Low</option>
                    </select>
                    {!!task && !isAdmin && (
                      <p className="text-[11px] text-text-muted mt-1">
                        Only admins can change priority
                      </p>
                    )}
                  </div>
                </div>

                {/* Task Kind & Schedule */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Schedule & Recurrence
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setKind("recurring")}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                          kind === "recurring"
                            ? "bg-primary-500 text-white"
                            : "bg-muted text-text-muted hover:text-foreground"
                        }`}
                      >
                        Recurring Habit
                      </button>
                      <button
                        type="button"
                        onClick={() => setKind("one_off")}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                          kind === "one_off"
                            ? "bg-primary-500 text-white"
                            : "bg-muted text-text-muted hover:text-foreground"
                        }`}
                      >
                        One-off Task
                      </button>
                    </div>
                  </div>

                  {kind === "one_off" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-text-muted block mb-1">Due Date</label>
                        <Input
                          type="date"
                          value={dueDate}
                          onChange={(e) => setDueDate(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-text-muted block mb-1">Due Time (optional)</label>
                        <Input
                          type="time"
                          value={dueTime}
                          onChange={(e) => setDueTime(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 bg-muted/40 p-4 rounded-xl border border-border">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs text-text-muted block mb-1">Repeats</label>
                          <select
                            value={recurrence}
                            onChange={(e) => setRecurrence(e.target.value as TaskRecurrence)}
                            className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm"
                          >
                            <option value="daily">Daily (Every day)</option>
                            <option value="weekdays">Weekdays (Mon–Fri)</option>
                            <option value="weekly">Weekly (Selected days)</option>
                            <option value="monthly">Monthly (Specific day)</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-text-muted block mb-1">
                            Due Time each day (optional)
                          </label>
                          <Input
                            type="time"
                            value={dueTime}
                            onChange={(e) => setDueTime(e.target.value)}
                          />
                        </div>
                      </div>

                      {recurrence === "weekly" && (
                        <div>
                          <label className="text-xs text-text-muted block mb-1.5">Active Days</label>
                          <div className="flex flex-wrap gap-1.5">
                            {WEEKDAYS.map((w) => {
                              const active = recurrenceDays.includes(w.day);
                              return (
                                <button
                                  key={w.day}
                                  type="button"
                                  onClick={() => toggleDay(w.day)}
                                  className={`w-9 h-9 rounded-lg text-xs font-bold transition-colors ${
                                    active
                                      ? "bg-primary-500 text-white"
                                      : "bg-card border border-border text-text-muted hover:text-foreground"
                                  }`}
                                >
                                  {w.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {recurrence === "monthly" && (
                        <div>
                          <label className="text-xs text-text-muted block mb-1">Day of Month</label>
                          <Input
                            type="number"
                            min={1}
                            max={31}
                            value={recurrenceMonthDay}
                            onChange={(e) => setRecurrenceMonthDay(Number(e.target.value))}
                            className="w-24"
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        <div>
                          <label className="text-xs text-text-muted block mb-1">Start Date</label>
                          <Input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-text-muted block mb-1">End Date (optional)</label>
                          <Input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Checklist template */}
                <div className="space-y-3 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                        Checklist ({checklist.length})
                      </span>
                      <span className="text-xs text-text-muted">
                        Items the assignee must check off before completing this task
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {checklist.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border"
                      >
                        <span className="text-xs text-text-muted w-5 text-right">{idx + 1}.</span>
                        <span className="text-sm text-foreground flex-1 truncate">{item}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveCheckItem(idx, -1)}
                            className="p-1 text-text-muted hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === checklist.length - 1}
                            onClick={() => moveCheckItem(idx, 1)}
                            className="p-1 text-text-muted hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCheckItem(idx)}
                            className="p-1 text-error-500 hover:text-error-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="flex gap-2">
                      <Input
                        value={newCheckItem}
                        onChange={(e) => setNewCheckItem(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCheckItem();
                          }
                        }}
                        placeholder="Add checklist item (press enter)"
                        className="text-sm"
                      />
                      <Button size="sm" type="button" onClick={addCheckItem}>
                        Add
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Proof & Metric Requirements */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                    Proof & Measurement Verification
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-text-muted block mb-1">Proof Required</label>
                      <select
                        value={proofRequired}
                        onChange={(e) => setProofRequired(e.target.value as ProofRequired)}
                        className="w-full h-10 px-3 rounded-lg border border-border bg-card text-foreground text-sm"
                      >
                        <option value="none">None (just check off)</option>
                        <option value="link">URL Link (e.g. tweet, sheet, PR)</option>
                        <option value="note">Written Note (e.g. summary, minutes)</option>
                        <option value="image">Screenshot / Image Upload</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-text-muted block mb-1">
                        Proof Instructions / Hint
                      </label>
                      <Input
                        value={proofHint}
                        onChange={(e) => setProofHint(e.target.value)}
                        placeholder="e.g. Paste link to Instagram post"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-muted/30 p-3 rounded-xl border border-border">
                    <div>
                      <label className="text-xs text-text-muted block mb-1">
                        Track a Metric (optional)
                      </label>
                      <Input
                        value={metricLabel}
                        onChange={(e) => setMetricLabel(e.target.value)}
                        placeholder="e.g. DMs sent, Calls booked"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-muted block mb-1">
                        Target Value (optional)
                      </label>
                      <Input
                        type="number"
                        value={metricTarget}
                        onChange={(e) => setMetricTarget(e.target.value)}
                        placeholder="e.g. 20"
                      />
                    </div>
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-2 pt-4 border-t border-border">
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                    Tags
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-muted text-foreground border border-border"
                      >
                        <span>#{t}</span>
                        <button
                          type="button"
                          onClick={() => removeTag(t)}
                          className="hover:text-error-500"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder="Add tag (e.g. marketing, sales, content)"
                      className="text-xs"
                    />
                    <Button size="sm" type="button" onClick={addTag}>
                      Add
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              /* History & Comments Tab */
              <div className="space-y-6">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">
                    Comments
                  </h4>
                  <div className="space-y-3 mb-4">
                    {comments.length === 0 ? (
                      <p className="text-xs text-text-muted">No comments yet.</p>
                    ) : (
                      comments.map((c) => (
                        <div
                          key={c.id}
                          className="p-3 rounded-xl bg-card border border-border text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between text-text-muted">
                            <span className="font-semibold text-foreground">
                              {c.authorProfile?.displayName ?? "User"}
                            </span>
                            <span>{new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          <p className="text-foreground">{c.body}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddComment();
                        }
                      }}
                      placeholder="Add a comment or feedback..."
                      className="text-xs"
                    />
                    <Button size="sm" onClick={handleAddComment} disabled={!newComment.trim() || isPending}>
                      <Send size={14} />
                    </Button>
                  </div>
                </div>

                <div className="pt-4 border-t border-border">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3 flex items-center gap-1.5">
                    <History size={14} />
                    <span>Audit Trail</span>
                  </h4>
                  <div className="space-y-2">
                    {events.length === 0 ? (
                      <p className="text-xs text-text-muted">No audit events recorded.</p>
                    ) : (
                      events.map((e) => (
                        <div
                          key={e.id}
                          className="p-2.5 rounded-lg bg-muted/40 border border-border text-[11px] flex items-center justify-between"
                        >
                          <div>
                            <span className="font-semibold text-foreground uppercase tracking-wide">
                              {e.action.replace(/_/g, " ")}
                            </span>
                            {e.actorProfile?.displayName && (
                              <span className="text-text-muted ml-1.5">
                                by {e.actorProfile.displayName}
                              </span>
                            )}
                          </div>
                          <span className="text-text-muted">
                            {new Date(e.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border bg-card flex items-center justify-between">
            {task ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTogglePause}
                  disabled={isPending}
                  className="text-xs"
                >
                  {task.status === "paused" ? (
                    <>
                      <Play size={14} className="mr-1 text-primary-500" /> Resume
                    </>
                  ) : (
                    <>
                      <Pause size={14} className="mr-1 text-status-yellow" /> Pause
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleArchive}
                  disabled={isPending}
                  className="text-xs text-error-500 hover:text-error-600"
                >
                  <Archive size={14} className="mr-1" /> Archive
                </Button>
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isPending}>
                {isPending ? "Saving..." : task ? "Save Changes" : "Create Task"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
