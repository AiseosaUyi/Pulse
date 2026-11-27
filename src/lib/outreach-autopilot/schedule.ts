// Pure time maths for the outreach autopilot: send windows, daily-cap pacing
// and the once-a-day approval digest, all in the tenant's own timezone.
// No I/O, so every rule here is unit-tested directly.

export interface LocalParts {
  /** 0-23 in the tenant's timezone. */
  hour: number;
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  isoWeekday: number;
  /** YYYY-MM-DD in the tenant's timezone. */
  dateKey: string;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function parts(date: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

export function localParts(now: Date, timeZone: string): LocalParts {
  const p = parts(now, timeZone);
  return {
    hour: Number(p.hour) % 24,
    isoWeekday: WEEKDAY[p.weekday] ?? 1,
    dateKey: `${p.year}-${p.month}-${p.day}`,
  };
}

/** UTC instant of local midnight (start of today) in `timeZone`. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const p = parts(now, timeZone);
  // Offset = wall clock read as UTC minus the real instant.
  const wallAsUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const midnightWallAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  return new Date(midnightWallAsUtc - offsetMs);
}

export interface WindowConfig {
  sendWindowStart: number;
  sendWindowEnd: number;
  sendWeekdays: number[];
}

export function isInSendWindow(now: Date, timeZone: string, w: WindowConfig): boolean {
  const lp = localParts(now, timeZone);
  if (!w.sendWeekdays.includes(lp.isoWeekday)) return false;
  return lp.hour >= w.sendWindowStart && lp.hour < w.sendWindowEnd;
}

/**
 * How many emails this cron tick may send. Spreads what is left of the daily
 * cap evenly over the ticks left in today's window, so sends trickle out
 * instead of leaving in one burst (better for deliverability).
 */
export function perTickQuota(opts: {
  dailyCap: number;
  sentToday: number;
  localHour: number;
  sendWindowEnd: number;
  ticksPerHour: number;
}): number {
  const remaining = Math.max(0, opts.dailyCap - opts.sentToday);
  if (remaining === 0) return 0;
  const hoursLeft = Math.max(1, opts.sendWindowEnd - opts.localHour);
  const ticksLeft = Math.max(1, hoursLeft * opts.ticksPerHour);
  return Math.min(remaining, Math.max(1, Math.ceil(remaining / ticksLeft)));
}

/** The digest goes out once per local day, at or after `digestHour`. */
export function isDigestDue(
  now: Date,
  timeZone: string,
  digestHour: number,
  lastDigestAt: string | null
): boolean {
  const lp = localParts(now, timeZone);
  if (lp.hour < digestHour) return false;
  if (!lastDigestAt) return true;
  return localParts(new Date(lastDigestAt), timeZone).dateKey !== lp.dateKey;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
