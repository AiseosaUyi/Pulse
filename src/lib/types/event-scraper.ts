export type EventScraperProvider = "apify" | "inhouse";
export type EventScraperRunStatus = "running" | "succeeded" | "failed" | "partial";
export type EventScraperRunTrigger = "cron" | "manual";

export interface EventScraperRunRecord {
  id: string;
  tenantSlug: string;
  platform: string;
  provider: EventScraperProvider;
  status: EventScraperRunStatus;
  trigger: EventScraperRunTrigger;
  startedAt: string;
  finishedAt: string | null;
  candidatesFound: number;
  prospectsCreated: number;
  error: Record<string, unknown> | null;
}

export interface EventScraperRunStepRecord {
  runId: string;
  step: string;
  attempt: number;
  status: "ok" | "failed" | "skipped";
  durationMs: number | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  recordedAt: string;
}

// Platform labels the UI shows next to each run — mirrors the two existing
// systems this feature unifies (old Apify-based platforms unchanged,
// new in-house ones added by this feature).
export const EVENT_PLATFORM_LABELS: Record<string, string> = {
  jetron: "Jetron",
  eventbrite: "Eventbrite",
  luma: "Luma",
  tix_africa: "Tix.africa",
  shows_ng: "Shows.ng",
  egotickets: "eGotickets",
  syticks: "Syticks",
  obodo: "Obodo",
  unboxd: "Unboxd",
  tiqbuy: "Tiqbuy",
  tixvnt: "Tixvnt",
};
