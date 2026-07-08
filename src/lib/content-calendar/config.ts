// Reads the tenant's content-calendar config out of settings.contentCalendar.
// Mirrors the getCadenceConfig / getBrandVoice readers (admin client,
// parse-or-default). Interest tags are a small, manually-maintained list —
// NOT a live follows-graph read (design doc, Premise 1 feasibility cut).

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const contentCalendarConfigSchema = z.object({
  niche: z.string().default("AI/tech"),
  interestTags: z.array(z.string()).default([]),
});

export type ContentCalendarConfig = z.infer<typeof contentCalendarConfigSchema>;

const DEFAULT_CONFIG: ContentCalendarConfig = { niche: "AI/tech", interestTags: [] };

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
