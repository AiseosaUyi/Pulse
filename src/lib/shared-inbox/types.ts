// Shared-inbox AI-away config — lives in tenants.settings.sharedInbox JSON.
// Mirrors src/lib/cadence/types.ts's pattern: Zod schema is the single
// source of truth for shape + validation, a defaultXConfig() gives every
// tenant a safe (disabled) starting point, and settings are read/written
// via the read-merge-write pattern (see lib/services/shared-inbox.ts /
// lib/actions/shared-inbox-settings.ts), never raw jsonb_set.
//
// `enabled` defaults to false — opt-in per tenant, per the plan's explicit
// safety requirement. Even when a tenant opts in, `AI_AUTO_REPLY_KILL_SWITCH`
// (checked via isAiAutoReplyKillSwitchActive() below) force-disables
// auto-sending everywhere, regardless of any tenant's settings — the
// eng-review-added global kill switch, checked first in
// lib/ai/shared-inbox-auto-reply.ts's maybeAutoReply().

import { z } from "zod";

export const officeHoursWindowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(40),
  // Days of week this window is active. 0 = Sunday … 6 = Saturday.
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  // 24h "HH:mm" local to the tenant timezone — start/end of a human-covered window.
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm"),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm"),
});

export type OfficeHoursWindow = z.infer<typeof officeHoursWindowSchema>;

export const sharedInboxConfigSchema = z.object({
  // Opt-in. AI never drafts or sends for a tenant until this is true.
  enabled: z.boolean(),
  // When true, AI covers around the clock — officeHours is ignored (treated
  // as "always away"). When false, AI covers only outside the configured
  // officeHours windows (the normal "away" case).
  alwaysOn: z.boolean(),
  // 0-1. A draft's confidenceScore must be >= this to auto-send; below it,
  // the draft is written as pending_review for a human to approve.
  autoSendConfidence: z.number().min(0).max(1),
  // IANA timezone, e.g. "Africa/Lagos". NEVER a fixed UTC offset (DST).
  timezone: z.string().min(1),
  // Human-covered windows. Outside all of these (or when alwaysOn is set,
  // unconditionally) is when AI is allowed to cover.
  officeHours: z.array(officeHoursWindowSchema).max(20),
});

export type SharedInboxConfig = z.infer<typeof sharedInboxConfigSchema>;

/** Safe starting point: disabled, moderate auto-send bar, no office-hours windows configured (falls back to "always away" once enabled — see isOutsideOfficeHours). */
export function defaultSharedInboxConfig(timezone = "UTC"): SharedInboxConfig {
  return {
    enabled: false,
    alwaysOn: false,
    autoSendConfidence: 0.8,
    timezone,
    officeHours: [],
  };
}

/**
 * Global incident lever (eng-review-added, both Pulse and Sippy tracks):
 * when set, maybeAutoReply() always writes pending_review and never sends,
 * regardless of any tenant's sharedInbox.enabled/alwaysOn/autoSendConfidence.
 * Flip via env change + restart — no per-tenant hunt-and-toggle mid-incident.
 * NEVER set by this task — code ships merged-but-inert, opt-in per tenant,
 * and this switch stays unset in every environment this task touches.
 */
export function isAiAutoReplyKillSwitchActive(): boolean {
  return Boolean(process.env.AI_AUTO_REPLY_KILL_SWITCH);
}
