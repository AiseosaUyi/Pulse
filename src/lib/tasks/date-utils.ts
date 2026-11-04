import type { OccurrenceStatus } from "@/lib/types/tasks";

/**
 * Returns today's date in `YYYY-MM-DD` in the given IANA timezone.
 */
export function getTenantToday(timeZone = "Africa/Lagos", now: Date = new Date()): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(now);
  } catch {
    return getTenantToday("UTC", now);
  }
}

/**
 * Returns the current time as `HH:mm:ss` in the given IANA timezone.
 */
export function getTenantTime(timeZone = "Africa/Lagos", now: Date = new Date()): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return fmt.format(now);
  } catch {
    return getTenantTime("UTC", now);
  }
}

/**
 * Returns ISO timestamp for a date `YYYY-MM-DD` and optional `HH:mm` or `HH:mm:ss` in a given timezone.
 * Defaults to 23:59:59 (end of day) if dueTime is not provided.
 */
export function getIsoDueAt(
  occursOn: string,
  dueTime: string | null | undefined,
  timeZone = "Africa/Lagos"
): string {
  const [y, m, d] = occursOn.split("-").map(Number);
  let hour = 23;
  let minute = 59;
  let second = 59;

  if (dueTime) {
    const parts = dueTime.split(":").map(Number);
    hour = !isNaN(parts[0]) ? parts[0] : 0;
    minute = !isNaN(parts[1]) ? parts[1] : 0;
    second = !isNaN(parts[2]) ? parts[2] : 0;
  }

  // Find UTC timestamp matching local wall-clock in target timeZone
  // Start with naive UTC guess
  const guessUtc = Date.UTC(y, m - 1, d, hour, minute, second);
  const guessDate = new Date(guessUtc);

  try {
    // Format guess in timeZone to find offset
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(guessDate).map((p) => [p.type, p.value]));
    let localH = parseInt(parts.hour, 10);
    if (localH === 24) localH = 0;
    const localUtc = Date.UTC(
      parseInt(parts.year, 10),
      parseInt(parts.month, 10) - 1,
      parseInt(parts.day, 10),
      localH,
      parseInt(parts.minute, 10),
      parseInt(parts.second, 10)
    );

    const diffMs = localUtc - guessUtc;
    const resolvedDate = new Date(guessUtc - diffMs);
    return resolvedDate.toISOString();
  } catch {
    return new Date(guessUtc).toISOString();
  }
}

/**
 * Given YYYY-MM-DD, returns ISO weekday 1=Mon .. 7=Sun.
 */
export function getIsoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Returns true if a task should generate an occurrence on dateStr (YYYY-MM-DD).
 */
export function isTaskScheduledForDate(
  task: {
    kind: string;
    startDate: string;
    endDate?: string | null;
    dueDate?: string | null;
    recurrence?: string | null;
    recurrenceDays?: number[] | null;
    recurrenceMonthDay?: number | null;
  },
  dateStr: string
): boolean {
  if (dateStr < task.startDate) return false;
  if (task.endDate && dateStr > task.endDate) return false;

  if (task.kind === "one_off") {
    return task.dueDate === dateStr;
  }

  if (task.kind === "recurring") {
    const isoWeekday = getIsoWeekday(dateStr);
    const dayOfMonth = parseInt(dateStr.slice(8, 10), 10);

    switch (task.recurrence) {
      case "daily":
        return true;
      case "weekdays":
        return isoWeekday >= 1 && isoWeekday <= 5;
      case "weekly":
        return Array.isArray(task.recurrenceDays) && task.recurrenceDays.includes(isoWeekday);
      case "monthly":
        return task.recurrenceMonthDay === dayOfMonth;
      default:
        return false;
    }
  }

  return false;
}

/**
 * Add calendar days to YYYY-MM-DD.
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Returns an array of date strings between from and to inclusive.
 */
export function getDatesInRange(fromStr: string, toStr: string): string[] {
  if (fromStr > toStr) return [];
  const dates: string[] = [];
  let curr = fromStr;
  while (curr <= toStr) {
    dates.push(curr);
    curr = addDays(curr, 1);
  }
  return dates;
}

/**
 * Calculate consecutive streak ending today (or yesterday if today is still pending).
 * Occurrences must be ordered chronologically or will be sorted.
 */
export function calculateStreak(
  occurrences: Array<{ occursOn: string; status: OccurrenceStatus }>,
  todayStr: string
): { currentStreak: number; longestStreak: number } {
  if (occurrences.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Sort chronologically ascending
  const sorted = [...occurrences]
    .filter((o) => o.status !== "skipped")
    .sort((a, b) => a.occursOn.localeCompare(b.occursOn));

  // Find longest streak across history
  let longestStreak = 0;
  let currentRun = 0;

  for (const occ of sorted) {
    if (occ.status === "done" || occ.status === "excused") {
      currentRun++;
      if (currentRun > longestStreak) longestStreak = currentRun;
    } else if (occ.status === "missed") {
      currentRun = 0;
    }
    // pending doesn't break or increment in the past
  }

  // Current streak calculation:
  // Check occurrences up to today
  const pastAndToday = sorted.filter((o) => o.occursOn <= todayStr);
  if (pastAndToday.length === 0) {
    return { currentStreak: 0, longestStreak };
  }

  const todayOcc = pastAndToday.find((o) => o.occursOn === todayStr);
  let checkIndex = pastAndToday.length - 1;

  if (todayOcc) {
    if (todayOcc.status === "pending") {
      // today is still pending — start checking from yesterday backwards
      checkIndex = pastAndToday.length - 2;
    } else if (todayOcc.status === "missed") {
      return { currentStreak: 0, longestStreak };
    }
  }

  let streak = 0;
  for (let i = checkIndex; i >= 0; i--) {
    const occ = pastAndToday[i];
    if (occ.status === "done" || occ.status === "excused") {
      streak++;
    } else if (occ.status === "missed") {
      break;
    }
    // pending in past? should be missed, break
    else if (occ.status === "pending") {
      break;
    }
  }

  return { currentStreak: streak, longestStreak };
}
