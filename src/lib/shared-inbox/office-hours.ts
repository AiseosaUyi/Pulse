// Pure office-hours math for the AI-covers-when-away gate. Reuses
// nowInTz/timeToMinutes from lib/cadence/compute.ts rather than
// reimplementing tz-aware wall-clock resolution — same DST-correct,
// never-throws behavior as the cadence tracker.
//
// Evaluated against the *message's* received time, not wall-clock at
// cron-run time (per the plan) — callers pass the inbound row's
// received_at, not `new Date().toISOString()`.

import { nowInTz, timeToMinutes } from "@/lib/cadence/compute";
import type { SharedInboxConfig } from "./types";

/**
 * True when `atIso` falls outside every configured office-hours window —
 * i.e. AI-away-coverage territory. `alwaysOn` short-circuits to true
 * (AI covers around the clock, office hours ignored). No windows
 * configured also means "always away" — a tenant that enables coverage
 * without defining any human-covered hours yet shouldn't be silently
 * inert.
 */
export function isOutsideOfficeHours(config: SharedInboxConfig, atIso: string): boolean {
  if (config.alwaysOn) return true;
  if (config.officeHours.length === 0) return true;

  const at = nowInTz(config.timezone, new Date(atIso));
  const withinAWindow = config.officeHours.some((w) => {
    if (!w.days.includes(at.weekday)) return false;
    const start = timeToMinutes(w.start);
    const end = timeToMinutes(w.end);
    return at.minutes >= start && at.minutes < end;
  });
  return !withinAWindow;
}

/**
 * The single gate maybeAutoReply() checks before drafting anything: the
 * tenant must have opted in (`enabled`) AND the message must have arrived
 * outside human coverage.
 */
export function shouldAiCover(config: SharedInboxConfig, receivedAtIso: string): boolean {
  if (!config.enabled) return false;
  return isOutsideOfficeHours(config, receivedAtIso);
}
