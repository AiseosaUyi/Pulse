"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { z } from "zod";

const inputSchema = z.object({
  niches: z.array(z.string().trim().min(1).max(60)).min(1).max(10),
  interestTags: z.array(z.string().trim().min(1).max(60)).max(30),
});

type ContentCalendarSettingsInput = z.infer<typeof inputSchema>;

type ActionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Persist content pillars + interest tags into settings.contentCalendar.
 * Merges into the EXISTING contentCalendar object rather than replacing it
 * wholesale — recentFeedback (the regenerate-reason learning log) lives in
 * the same JSONB blob and must survive a settings save untouched.
 */
export async function saveContentCalendarConfig(
  tenantSlug: string,
  input: ContentCalendarSettingsInput
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" · ") };
  }

  const supabase = await createClient();
  const { data: tenant, error: readError } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (readError) return { success: false, error: readError.message };

  const existing = (tenant?.settings as Record<string, unknown>) ?? {};
  const existingContentCalendar = (existing.contentCalendar as Record<string, unknown>) ?? {};
  const { error: writeError } = await supabase
    .from("tenants")
    .update({
      settings: {
        ...existing,
        contentCalendar: { ...existingContentCalendar, ...parsed.data },
      },
    })
    .eq("slug", tenantSlug);
  if (writeError) return { success: false, error: writeError.message };

  revalidatePath("/settings/content-calendar");
  revalidatePath("/content-calendar");
  return { success: true };
}
