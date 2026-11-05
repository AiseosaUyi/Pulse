import type { WeeklyTargets } from "./team";

export type TaskPriority = "urgent" | "high" | "normal" | "low";
export type TaskKind = "one_off" | "recurring";
export type TaskRecurrence = "daily" | "weekdays" | "weekly" | "monthly";
export type RecurrenceFrequency = TaskRecurrence;
export type ProofRequired = "none" | "link" | "note" | "image";
export type TaskStatus = "active" | "paused" | "archived";
export type OccurrenceStatus = "pending" | "done" | "missed" | "excused" | "skipped";
export type LinkedType = "prospect" | "event" | "post" | "campaign";

export interface TeamPerson {
  id: string;
  tenantSlug: string;
  name: string;
  userId: string | null;
  leadPersonId: string | null;
  roleTitle?: string | null;
  tags: string[];
  weeklyTargets: WeeklyTargets;
  email?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  leadPerson?: TeamPerson | null;
}

export interface TaskChecklistItem {
  id: string;
  tenantSlug: string;
  taskId: string;
  position: number;
  label: string;
}

export interface Task {
  id: string;
  tenantSlug: string;
  title: string;
  description: string | null;
  ownerPersonId: string;
  createdBy: string;
  priority: TaskPriority;
  kind: TaskKind;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD (one_off only)
  dueTime: string | null; // HH:mm:ss or HH:mm
  recurrence: TaskRecurrence | null;
  recurrenceDays: number[] | null; // 1=Mon .. 7=Sun
  recurrenceMonthDay: number | null; // 1..31
  proofRequired: ProofRequired;
  proofHint: string | null;
  metricLabel: string | null;
  metricTarget: number | null;
  linkedType: LinkedType | null;
  linkedId: string | null;
  status: TaskStatus;
  pausedUntil: string | null; // YYYY-MM-DD
  tags: string[];
  createdAt: string;
  updatedAt: string;
  owner?: TeamPerson;
  checklist?: TaskChecklistItem[];
  currentStreak?: number;
}

export interface TaskOccurrenceCheck {
  id: string;
  tenantSlug: string;
  occurrenceId: string;
  position: number;
  label: string;
  checked: boolean;
  checkedAt: string | null;
  checkedBy: string | null;
}

export interface TaskOccurrence {
  id: string;
  tenantSlug: string;
  taskId: string;
  ownerPersonId: string;
  occursOn: string; // YYYY-MM-DD
  dueAt: string; // ISO timestamptz
  status: OccurrenceStatus;
  completedAt: string | null;
  completedBy: string | null;
  completedLate: boolean;
  proofUrl: string | null;
  proofNote: string | null;
  proofImagePath: string | null;
  metricValue: number | null;
  excusedBy: string | null;
  excusedReason: string | null;
  createdAt: string;
  task?: Task;
  owner?: TeamPerson;
  checks: TaskOccurrenceCheck[];
  completedByProfile?: { displayName: string | null; avatarUrl: string | null };
}

export interface TaskComment {
  id: string;
  tenantSlug: string;
  taskId: string;
  occurrenceId: string | null;
  author: string;
  body: string;
  createdAt: string;
  authorProfile?: {
    displayName: string;
    avatarUrl: string | null;
  };
}

export interface PersonLeave {
  id: string;
  tenantSlug: string;
  personId: string;
  startsOn: string; // YYYY-MM-DD
  endsOn: string; // YYYY-MM-DD
  reason: string | null;
  status: "requested" | "approved" | "declined" | "cancelled";
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdBy: string;
  createdAt: string;
  person?: TeamPerson;
}

export interface TaskEvent {
  id: number;
  tenantSlug: string;
  taskId: string | null;
  occurrenceId: string | null;
  actor: string | null;
  action: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  actorProfile?: {
    displayName: string;
  };
}

export interface StreakSquare {
  date: string; // YYYY-MM-DD
  status: OccurrenceStatus | "none";
  occurrenceId?: string;
  completedLate?: boolean;
  belowTarget?: boolean;
  proofUrl?: string | null;
  proofNote?: string | null;
  proofImagePath?: string | null;
  metricValue?: number | null;
  metricTarget?: number | null;
  metricLabel?: string | null;
}

export interface TaskStreakRow {
  task: Task;
  currentStreak: number;
  longestStreak: number;
  completionRate30d: number; // percentage 0-100
  breachesThisMonth: number;
  squares: StreakSquare[];
}

export interface PersonStreakGroup {
  person: TeamPerson;
  tasks: TaskStreakRow[];
}

export interface StandupPersonStats {
  person: TeamPerson;
  completedTasks: Array<{
    title: string;
    completedAt: string;
    proofUrl?: string | null;
    metricValue?: number | null;
    metricLabel?: string | null;
  }>;
  recurringStats: Array<{
    taskTitle: string;
    done: number;
    total: number;
    rate: number; // 0-100
  }>;
  breaches: Array<{
    taskTitle: string;
    occursOn: string;
  }>;
  metricTotals: Array<{
    label: string;
    total: number;
    target?: number | null;
  }>;
  openOneOffTasks: Array<{
    title: string;
    dueDate: string;
    daysOverdue: number;
  }>;
}

export interface StandupReport {
  range: {
    from: string; // YYYY-MM-DD
    to: string; // YYYY-MM-DD
  };
  people: StandupPersonStats[];
  whatsAppText: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  ownerPersonId?: string | null;
  priority?: TaskPriority;
  kind: TaskKind;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  recurrence?: TaskRecurrence | null;
  recurrenceDays?: number[] | null;
  recurrenceMonthDay?: number | null;
  proofRequired?: ProofRequired;
  proofHint?: string | null;
  metricLabel?: string | null;
  metricTarget?: number | null;
  linkedType?: LinkedType | null;
  linkedId?: string | null;
  tags?: string[];
  checklist?: string[]; // list of labels
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  ownerPersonId?: string | null;
  priority?: TaskPriority;
  kind?: TaskKind;
  startDate?: string;
  endDate?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  recurrence?: TaskRecurrence | null;
  recurrenceDays?: number[] | null;
  recurrenceMonthDay?: number | null;
  proofRequired?: ProofRequired;
  proofHint?: string | null;
  metricLabel?: string | null;
  metricTarget?: number | null;
  linkedType?: LinkedType | null;
  linkedId?: string | null;
  tags?: string[];
  status?: TaskStatus;
  pausedUntil?: string | null;
  checklist?: string[]; // updated labels
}
