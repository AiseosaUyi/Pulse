"use client";

import { useState, useEffect, useTransition } from "react";
import {
  X,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Pause,
  Play,
  Archive,
  History,
  MessageSquare,
  Send,
  Link as LinkIcon,
  Flame,
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

export function TaskDrawer({
  isOpen,
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

  // Form states
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerPersonId, setOwnerPersonId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [kind, setKind] = useState<TaskKind>("recurring");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [recurrence, setRecurrence] = useState<TaskRecurrence>("daily");
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState<number>(1);
  const [proofRequired, setProofRequired] = useState<ProofRequired>("none");
  const [proofHint, setProofHint] = useState("");
  const [metricLabel, setMetricLabel] = useState("");
  const [metricTarget, setMetricTarget] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [newCheckItem, setNewCheckItem] = useState("");

  // Quick add person state
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");

  // History & Comments
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");

  // Initialize form when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setOwnerPersonId(task.ownerPersonId);
      setPriority(task.priority);
      setKind(task.kind);
      setStartDate(task.startDate);
      setEndDate(task.endDate ?? "");
      setDueDate(task.dueDate ?? "");
      setDueTime(task.dueTime ? task.dueTime.slice(0, 5) : "");
      setRecurrence(task.recurrence ?? "daily");
      setRecurrenceDays(task.recurrenceDays ?? [1, 2, 3, 4, 5]);
      setRecurrenceMonthDay(task.recurrenceMonthDay ?? 1);
      setProofRequired(task.proofRequired);
      setProofHint(task.proofHint ?? "");
      setMetricLabel(task.metricLabel ?? "");
      setMetricTarget(task.metricTarget !== null && task.metricTarget !== undefined ? String(task.metricTarget) : "");
      setTags(task.tags ?? []);
      setChecklist(task.checklist ? task.checklist.map((c) => c.label) : []);
    } else {
      // Default for new task
      const today = new Date().toISOString().slice(0, 10);
      setTitle("");
      setDescription("");
      const initialOwner = defaultPersonId || people.find((p) => p.userId === currentUserId)?.id || people[0]?.id || "";
      setOwnerPersonId(initialOwner);
      setPriority("normal");
      setKind("recurring");
      setStartDate(today);
      setEndDate("");
      setDueDate(today);
      setDueTime("");
      setRecurrence("daily");
      setRecurrenceDays([1, 2, 3, 4, 5]);
      setRecurrenceMonthDay(1);
      setProofRequired("none");
      setProofHint("");
      setMetricLabel("");
      setMetricTarget("");
      setTags([]);
      setChecklist([]);
    }
  }, [task, people, defaultPersonId, currentUserId, isOpen]);

  // Load history and comments when drawer opens for existing task
  useEffect(() => {
    if (isOpen && task?.id) {
      fetch(`/api/v1/tasks/${task.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            setEvents(data.events ?? []);
            setComments(data.comments ?? []);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, task?.id]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!title.trim()) {
      toast.error("Task title is required");
      return;
    }
    if (!ownerPersonId) {
      toast.error("Please assign an owner to this task");
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
          ownerPersonId,
          priority,
          kind,
          startDate,
          endDate: endDate || null,
          dueDate: kind === "one_off" ? dueDate || null : null,
          dueTime: dueTime ? `${dueTime}:00` : null,
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
        if (!res.success) {
          toast.error(res.error ?? "Failed to update task");
          return;
        }

        toast.success("Task updated");
        if (res.task && onTaskSaved) onTaskSaved(res.task);
        onClose();
      } else {
        // Create
        const input: CreateTaskInput = {
          title: title.trim(),
          description: description.trim() || null,
          ownerPersonId,
          priority,
          kind,
          startDate,
          endDate: endDate || null,
          dueDate: kind === "one_off" ? dueDate || null : null,
          dueTime: dueTime ? `${dueTime}:00` : null,
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
        if (!res.success) {
          toast.error(res.error ?? "Failed to create task");
          return;
        }

        toast.success("Task created");
        if (res.task && onTaskSaved) onTaskSaved(res.task);
        onClose();
      }
    });
  };

  const handleArchive = () => {
    if (!task) return;
    if (!confirm("Are you sure you want to archive this task? Missed occurrences will remain on the accountability record.")) {
      return;
    }

    startTransition(async () => {
      const res = await archiveTaskAction(task.id);
      if (!res.success) {
        toast.error(res.error ?? "Failed to archive task");
        return;
      }
      toast.success("Task archived");
      onClose();
    });
  };

  const handleTogglePause = () => {
    if (!task) return;
    const nextStatus = task.status === "paused" ? "active" : "paused";

    startTransition(async () => {
      const res = await updateTaskAction(task.id, { status: nextStatus });
      if (!res.success) {
        toast.error(res.error ?? "Failed to change task status");
        return;
      }
      toast.success(nextStatus === "paused" ? "Task paused" : "Task resumed");
      if (res.task && onTaskSaved) onTaskSaved(res.task);
      onClose();
    });
  };

  const handleAddCheckItem = () => {
    if (!newCheckItem.trim()) return;
    setChecklist([...checklist, newCheckItem.trim()]);
    setNewCheckItem("");
  };

  const handleRemoveCheckItem = (idx: number) => {
    setChecklist(checklist.filter((_, i) => i !== idx));
  };

  const handleMoveCheckItem = (idx: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= checklist.length) return;
    const updated = [...checklist];
    const [moved] = updated.splice(idx, 1);
    updated.splice(targetIdx, 0, moved);
    setChecklist(updated);
  };

  const handleAddTag = () => {
    const clean = tagInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!clean || tags.includes(clean)) return;
    setTags([...tags, clean]);
    setTagInput("");
  };

  const handleRemoveTag = (t: string) => {
    setTags(tags.filter((item) => item !== t));
  };

  const handleAddPerson = async () => {
    if (!newPersonName.trim()) return;
    const res = await createTeamPersonAction({ name: newPersonName.trim() });
    if (res.success && res.person) {
      toast.success(`Added ${res.person.name}`);
      setOwnerPersonId(res.person.id);
      setShowAddPerson(false);
      setNewPersonName("");
    } else {
      toast.error(res.error ?? "Failed to add person");
    }
  };

  const handleSendComment = async () => {
    if (!task || !newComment.trim()) return;
    const commentBody = newComment.trim();
    setNewComment("");
    const res = await addCommentAction(task.id, null, commentBody);
    if (res.success && res.comment) {
      setComments([...comments, res.comment]);
    } else {
      toast.error(res.error ?? "Failed to add comment");
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-2xl bg-card h-full shadow-2xl flex flex-col border-l border-border animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {task ? "Edit Task" : "New Team Task"}
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {task?.kind === "recurring" ? "Daily habit / recurring" : "One-off team task"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {task && (
              <div className="flex rounded-lg border border-border p-0.5 bg-background text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab("edit")}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    activeTab === "edit"
                      ? "bg-primary-500 text-white"
                      : "text-text-secondary hover:text-foreground"
                  }`}
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("history")}
                  className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                    activeTab === "history"
                      ? "bg-primary-500 text-white"
                      : "text-text-secondary hover:text-foreground"
                  }`}
                >
                  <History size={13} />
                  History
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-foreground hover:bg-card-hover transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "edit" ? (
            <>
              {/* Title & Description */}
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1">
                    Task Title *
                  </label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Daily post on Gruve Lagos"
                    className="font-medium text-base"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1">
                    Description (optional markdown)
                  </label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Instructions, guidelines or context for the owner..."
                    rows={3}
                  />
                </div>
              </div>

              {/* Owner & Priority */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Owner *
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowAddPerson(!showAddPerson)}
                      className="text-xs text-primary-500 hover:underline"
                    >
                      + Add person
                    </button>
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
                    <select
                      value={ownerPersonId}
                      onChange={(e) => setOwnerPersonId(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="" disabled>
                        Select assignee
                      </option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {!p.userId ? "(no login)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-1">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              {/* Task Kind & Schedule */}
              <div className="p-4 rounded-xl border border-border bg-background space-y-4">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-foreground">
                    <input
                      type="radio"
                      name="task_kind"
                      checked={kind === "recurring"}
                      onChange={() => setKind("recurring")}
                      className="accent-primary-500"
                    />
                    Recurring Habit
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-foreground">
                    <input
                      type="radio"
                      name="task_kind"
                      checked={kind === "one_off"}
                      onChange={() => setKind("one_off")}
                      className="accent-primary-500"
                    />
                    One-off Task
                  </label>
                </div>

                {kind === "recurring" ? (
                  <div className="space-y-4 pt-2 border-t border-border">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-text-secondary block mb-1">
                          Recurrence
                        </label>
                        <select
                          value={recurrence}
                          onChange={(e) => setRecurrence(e.target.value as TaskRecurrence)}
                          className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm"
                        >
                          <option value="daily">Every day</option>
                          <option value="weekdays">Weekdays (Mon-Fri)</option>
                          <option value="weekly">Specific days of week</option>
                          <option value="monthly">Monthly on day N</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-text-secondary block mb-1">
                          Due Time (optional)
                        </label>
                        <Input
                          type="time"
                          value={dueTime}
                          onChange={(e) => setDueTime(e.target.value)}
                          placeholder="e.g. 18:00 (default: 23:59)"
                          className="text-sm"
                        />
                      </div>
                    </div>

                    {recurrence === "weekly" && (
                      <div>
                        <label className="text-xs font-semibold text-text-secondary block mb-2">
                          Select Days of the Week
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {WEEKDAYS.map((w) => {
                            const isSelected = recurrenceDays.includes(w.day);
                            return (
                              <button
                                key={w.day}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setRecurrenceDays(recurrenceDays.filter((d) => d !== w.day));
                                  } else {
                                    setRecurrenceDays([...recurrenceDays, w.day]);
                                  }
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                  isSelected
                                    ? "bg-primary-500 text-white"
                                    : "bg-card border border-border text-text-secondary hover:text-foreground"
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
                        <label className="text-xs font-semibold text-text-secondary block mb-1">
                          Day of the Month (1-31)
                        </label>
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          value={recurrenceMonthDay}
                          onChange={(e) => setRecurrenceMonthDay(Number(e.target.value))}
                          className="w-32 text-sm"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-text-secondary block mb-1">
                          Start Date *
                        </label>
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="text-sm"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-text-secondary block mb-1">
                          End Date (optional)
                        </label>
                        <Input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          placeholder="Runs indefinitely"
                          className="text-sm"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 pt-2 border-t border-border">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-text-secondary block mb-1">
                          Due Date *
                        </label>
                        <Input
                          type="date"
                          value={dueDate}
                          onChange={(e) => setDueDate(e.target.value)}
                          className="text-sm"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-text-secondary block mb-1">
                          Due Time (optional)
                        </label>
                        <Input
                          type="time"
                          value={dueTime}
                          onChange={(e) => setDueTime(e.target.value)}
                          className="text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Checklist Template */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                  Checklist Template (All required to complete)
                </label>

                {checklist.length > 0 && (
                  <div className="space-y-2">
                    {checklist.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-background"
                      >
                        <span className="text-xs text-text-muted w-5 font-mono">
                          {idx + 1}.
                        </span>
                        <span className="text-sm text-foreground flex-1 font-medium">
                          {item}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMoveCheckItem(idx, "up")}
                            disabled={idx === 0}
                            className="p-1 text-text-muted hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveCheckItem(idx, "down")}
                            disabled={idx === checklist.length - 1}
                            className="p-1 text-text-muted hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveCheckItem(idx)}
                            className="p-1 text-text-muted hover:text-error-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    value={newCheckItem}
                    onChange={(e) => setNewCheckItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCheckItem();
                      }
                    }}
                    placeholder="Add checklist item (e.g. Posted on @gruve_official)"
                    className="text-sm"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleAddCheckItem}>
                    Add
                  </Button>
                </div>
              </div>

              {/* Proof and Measurement */}
              <div className="space-y-4 p-4 rounded-xl border border-border bg-background">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Proof & Verification
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      Proof Required
                    </label>
                    <select
                      value={proofRequired}
                      onChange={(e) => setProofRequired(e.target.value as ProofRequired)}
                      className="w-full h-9 px-3 rounded-lg border border-border bg-card text-foreground text-sm"
                    >
                      <option value="none">None (Trust-based)</option>
                      <option value="link">URL Link (e.g. Discord or post)</option>
                      <option value="note">Written Note (e.g. summary)</option>
                      <option value="image">Screenshot / Image upload</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      Proof Hint (optional)
                    </label>
                    <Input
                      value={proofHint}
                      onChange={(e) => setProofHint(e.target.value)}
                      placeholder='e.g. "Paste the Discord message link"'
                      className="text-sm"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      Metric Label (optional)
                    </label>
                    <Input
                      value={metricLabel}
                      onChange={(e) => setMetricLabel(e.target.value)}
                      placeholder='e.g. "DMs sent", "Followers gained"'
                      className="text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1">
                      Metric Target (optional)
                    </label>
                    <Input
                      type="number"
                      value={metricTarget}
                      onChange={(e) => setMetricTarget(e.target.value)}
                      placeholder="e.g. 10"
                      className="text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">
                  Tags
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="px-2.5 py-1 rounded-md text-xs font-medium bg-card-hover border border-border text-foreground flex items-center gap-1.5"
                    >
                      #{t}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(t)}
                        className="text-text-muted hover:text-foreground"
                      >
                        ×
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
                        handleAddTag();
                      }
                    }}
                    placeholder="Add tag (e.g. social, outreach)"
                    className="text-sm"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleAddTag}>
                    Add
                  </Button>
                </div>
              </div>

              {/* Status Actions (Pause, Archive) */}
              {task && (
                <div className="pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTogglePause}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    {task.status === "paused" ? (
                      <>
                        <Play size={14} className="text-success-500" />
                        Resume Task
                      </>
                    ) : (
                      <>
                        <Pause size={14} className="text-warning-500" />
                        Pause Task
                      </>
                    )}
                  </Button>

                  {isAdmin && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleArchive}
                      className="flex items-center gap-1.5 text-xs text-error-500 hover:bg-error-500/10"
                    >
                      <Archive size={14} />
                      Archive Task
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            /* History & Audit Tab */
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">
                  Audit Trail
                </h3>
                {events.length === 0 ? (
                  <p className="text-xs text-text-muted">No audit events recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {events.map((e) => (
                      <div
                        key={e.id}
                        className="p-3 rounded-lg border border-border bg-background text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between text-text-secondary">
                          <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
                            {e.action}
                          </span>
                          <span>
                            {new Date(e.createdAt).toLocaleString("en-GB", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-text-secondary">
                          By <strong className="text-foreground">{e.actorProfile?.displayName ?? "User"}</strong>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Comments Section */}
          {task && (
            <div className="pt-6 border-t border-border space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wider">
                <MessageSquare size={14} />
                Comments & Discussion
              </div>

              {comments.length > 0 && (
                <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-lg border border-border bg-card text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">
                          {c.authorProfile?.displayName ?? "Team member"}
                        </span>
                        <span className="text-text-muted text-[10px]">
                          {new Date(c.createdAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-text-secondary whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendComment();
                    }
                  }}
                  placeholder="Leave a comment or question..."
                  className="text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleSendComment}
                  disabled={!newComment.trim()}
                >
                  <Send size={14} />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3 bg-background">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending} className="px-6">
            {isPending ? "Saving..." : task ? "Save Changes" : "Create Task"}
          </Button>
        </div>
      </div>
    </div>
  );
}
