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

const contentCalendarConfigSchema = z.preprocess(
  migrateLegacyShape,
  z.object({
    niches: z.array(z.string()).min(1).default(["AI/tech"]),
    interestTags: z.array(z.string()).default([]),
  })
);

export type ContentCalendarConfig = z.infer<typeof contentCalendarConfigSchema>;

const DEFAULT_CONFIG: ContentCalendarConfig = { niches: ["AI/tech"], interestTags: [] };

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
