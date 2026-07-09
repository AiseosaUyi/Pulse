// Reads the tenant's content-calendar config out of settings.contentCalendar.
// Mirrors the getCadenceConfig / getBrandVoice readers (admin client,
// parse-or-default). Interest tags are a small, manually-maintained list —
// NOT a live follows-graph read (design doc, Premise 1 feasibility cut).

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

// `niches` (plural — "content pillars") replaced the original single
// `niche` string (2026-07-09): a solo creator covering e.g. "AI tools",
// "AI in design", and "startups" needs distinct rotating pillars, not one
// blended free-text category. `migrateLegacyShape` upgrades any
// already-saved `{ niche: string }` row on read so existing tenants don't
// lose their config.
function migrateLegacyShape(val: unknown): unknown {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const v = val as Record<string, unknown>;
    if (typeof v.niche === "string" && !("niches" in v)) {
      const { niche, ...rest } = v;
      return { ...rest, niches: [niche] };
    }
  }
  return val;
}

const feedbackEntrySchema = z.object({
  reason: z.string(),
  pillar: z.string().nullable(),
  at: z.string(),
});

const contentCalendarConfigSchema = z.preprocess(
  migrateLegacyShape,
  z.object({
    niches: z.array(z.string()).min(1).default(["AI/tech"]),
    interestTags: z.array(z.string()).default([]),
    // How many slots a fresh batch packs onto each calendar day before
    // moving to the next one. Default 1 (one slot per day). Raised from an
    // implicit hardcoded 1 (2026-07-09) — some days a creator can film
    // multiple, other days none, and a rigid one-per-day spread didn't
    // match that.
    postsPerDay: z.number().int().min(1).max(5).default(1),
    // Rolling log of stated regenerate reasons — the immediate half of the
    // "learning loop" (senior-uiux audit, 2026-07-09, stage 05): closes the
    // loop from what the creator said didn't work back into future topic
    // selection. The OTHER half (post-performance metrics → selection)
    // needs weeks of real posting history to correlate against and can't
    // be built yet — see TODOS.md P9.
    recentFeedback: z.array(feedbackEntrySchema).max(20).default([]),
  })
);

export type ContentCalendarConfig = z.infer<typeof contentCalendarConfigSchema>;
export type ContentCalendarFeedbackEntry = z.infer<typeof feedbackEntrySchema>;

const DEFAULT_CONFIG: ContentCalendarConfig = {
  niches: ["AI/tech"],
  interestTags: [],
  postsPerDay: 1,
  recentFeedback: [],
};

export async function getContentCalendarConfig(
  tenantSlug: string
): Promise<ContentCalendarConfig> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (error || !data?.settings) return DEFAULT_CONFIG;

  const parsed = contentCalendarConfigSchema.safeParse(
    (data.settings as { contentCalendar?: unknown }).contentCalendar
  );
  return parsed.success ? parsed.data : DEFAULT_CONFIG;
}

// Appends one regenerate-reason entry (capped to the last 20) without
// disturbing niches/interestTags — read-modify-write on the SAME row
// saveContentCalendarConfig writes, so both must merge, never replace
// wholesale (see the merge fix in content-calendar-settings.ts).
export async function appendContentCalendarFeedback(
  tenantSlug: string,
  entry: { reason: string; pillar: string | null }
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();

  const existingSettings = (data?.settings as Record<string, unknown>) ?? {};
  const parsed = contentCalendarConfigSchema.safeParse(
    (existingSettings as { contentCalendar?: unknown }).contentCalendar
  );
  const config = parsed.success ? parsed.data : DEFAULT_CONFIG;

  const recentFeedback = [
    ...config.recentFeedback,
    { reason: entry.reason, pillar: entry.pillar, at: new Date().toISOString() },
  ].slice(-20);

  await admin
    .from("tenants")
    .update({
      settings: {
        ...existingSettings,
        contentCalendar: { ...config, recentFeedback },
      },
    })
    .eq("slug", tenantSlug);
}
