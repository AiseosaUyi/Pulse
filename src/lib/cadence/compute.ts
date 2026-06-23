// Pure cadence math, per platform. Side-effect-free (no Date/tz reads inside the
// core function) so it's unit-testable: the caller resolves "now in the tenant
// tz" via nowInTz() and passes the parts in.

import {
  cadencePlatforms,
  type CadenceConfig,
  type CadencePlatform,
  type PlatformTracker,
  type PostLogRow,
  type Tracker,
  type TrackerWindow,
  type WindowStatus,
} from "./types";

export interface NowParts {
  date: string; // YYYY-MM-DD in tenant tz
  minutes: number; // minutes since local midnight (0–1439)
  weekday: number; // 0=Sun … 6=Sat
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Resolve "now" in an IANA timezone to { date, minutes, weekday }. Falls back to
 * UTC if the tz is invalid (never throws). DST-correct (Intl resolves wall-clock).
 */
export function nowInTz(tz: string, now: Date = new Date()): NowParts {
  let parts: Record<string, string>;
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  } catch {
    return nowInTz("UTC", now);
  }
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  const minutes = hour * 60 + parseInt(parts.minute, 10);
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes, weekday: wd[parts.weekday] ?? 0 };
}

function buildWeek(rows: PostLogRow[], todayStr: string): Tracker["week"] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.posted_date, (counts.get(r.posted_date) ?? 0) + 1);
  const [y, m, d] = todayStr.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const week: Tracker["week"] = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(base - i * 86_400_000);
    const ds = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    week.push({ date: ds, count: counts.get(ds) ?? 0, isToday: ds === todayStr });
  }
  return week;
}

function buildPlatform(
  config: CadenceConfig,
  platform: CadencePlatform,
  todayRows: PostLogRow[],
  now: NowParts
): PlatformTracker {
  const mine = todayRows.filter((r) => r.platform === platform);
  const posted = mine.length;
  const target = config.targets[platform] ?? 0;

  const doneIds = new Set(
    mine.map((r) => r.window_id).filter((id): id is string => Boolean(id))
  );

  const active = config.windows
    .filter((w) => w.platform === platform && w.days.includes(now.weekday))
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  type Prelim = { id: string; label: string; time: string; kind: "done" | "due" | "upcoming" };
  const prelim: Prelim[] = active.map((w) => {
    if (doneIds.has(w.id)) return { id: w.id, label: w.label, time: w.time, kind: "done" };
    if (now.minutes < timeToMinutes(w.time)) return { id: w.id, label: w.label, time: w.time, kind: "upcoming" };
    return { id: w.id, label: w.label, time: w.time, kind: "due" };
  });

  const dues = prelim.filter((p) => p.kind === "due");
  let nowId: string | null = null;
  if (dues.length > 0) nowId = dues[dues.length - 1].id;
  else {
    const firstUpcoming = prelim.find((p) => p.kind === "upcoming");
    if (firstUpcoming) nowId = firstUpcoming.id;
  }

  const windows: TrackerWindow[] = prelim.map((p) => {
    let status: WindowStatus;
    if (p.kind === "done") status = "done";
    else if (p.id === nowId) status = "now";
    else if (p.kind === "due") status = "missed";
    else status = "upcoming";
    return { id: p.id, label: p.label, time: p.time, status };
  });

  return { platform, windows, posted, target, behind: posted < target };
}

/**
 * Compute the per-platform tracker for the tenant's "today". A platform appears
 * if it has a target > 0 or any configured window. "behind" = any platform below
 * its target.
 */
export function computeTracker(config: CadenceConfig, rows: PostLogRow[], now: NowParts): Tracker {
  const todayRows = rows.filter((r) => r.posted_date === now.date);

  const platforms = cadencePlatforms
    .map((p) => buildPlatform(config, p, todayRows, now))
    .filter((pt) => pt.target > 0 || pt.windows.length > 0);

  const week = buildWeek(rows, now.date);

  return {
    platforms,
    behind: platforms.some((pt) => pt.behind),
    week,
    daysActiveThisWeek: week.filter((d) => d.count > 0).length,
  };
}
