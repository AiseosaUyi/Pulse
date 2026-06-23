// Cadence config — lives in tenants.settings.cadence JSON. Per-platform:
// the goal is a steady beat per network (e.g. X 3×/day, LinkedIn 1×/day), so
// windows are tagged by platform and targets are per platform.

import { z } from "zod";

export const cadencePlatforms = ["x", "linkedin"] as const;
export type CadencePlatform = (typeof cadencePlatforms)[number];

export const PLATFORM_LABEL: Record<CadencePlatform, string> = {
  x: "X",
  linkedin: "LinkedIn",
};

export const cadenceWindowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(40),
  platform: z.enum(cadencePlatforms),
  // 24h "HH:mm" local to the tenant timezone.
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm"),
  // Days of week this window is active. 0 = Sunday … 6 = Saturday.
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

export type CadenceWindow = z.infer<typeof cadenceWindowSchema>;

export const cadenceConfigSchema = z.object({
  enabled: z.boolean(),
  // Per-platform daily targets.
  targets: z.object({
    x: z.number().int().min(0).max(20),
    linkedin: z.number().int().min(0).max(20),
  }),
  windows: z.array(cadenceWindowSchema).max(20),
  // IANA timezone, e.g. "Africa/Lagos". NEVER a fixed UTC offset (DST).
  timezone: z.string().min(1),
});

export type CadenceConfig = z.infer<typeof cadenceConfigSchema>;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Starter beat: 3 X windows + 1 LinkedIn window, targets 3/1, disabled until turned on. */
export function defaultCadenceConfig(timezone = "UTC"): CadenceConfig {
  return {
    enabled: false,
    targets: { x: 3, linkedin: 1 },
    timezone,
    windows: [
      { id: "x_morning", label: "Morning", platform: "x", time: "09:00", days: ALL_DAYS },
      { id: "x_midday", label: "Midday", platform: "x", time: "13:00", days: ALL_DAYS },
      { id: "x_evening", label: "Evening", platform: "x", time: "18:00", days: ALL_DAYS },
      { id: "li_midmorning", label: "Mid-morning", platform: "linkedin", time: "10:00", days: [1, 2, 3, 4, 5] },
    ],
  };
}

export type WindowStatus = "done" | "now" | "missed" | "upcoming";

export interface TrackerWindow {
  id: string;
  label: string;
  time: string;
  status: WindowStatus;
}

export interface PlatformTracker {
  platform: CadencePlatform;
  windows: TrackerWindow[];
  posted: number;
  target: number;
  behind: boolean;
}

export interface DayCell {
  date: string; // YYYY-MM-DD (tenant tz)
  count: number;
  isToday: boolean;
}

export interface Tracker {
  platforms: PlatformTracker[];
  /** True when any platform is behind its target today. */
  behind: boolean;
  week: DayCell[];
  daysActiveThisWeek: number;
}

/** A post_log row, narrowed to the fields the tracker math needs. */
export interface PostLogRow {
  posted_date: string; // YYYY-MM-DD (tenant tz)
  window_id: string | null;
  platform: string | null;
}
