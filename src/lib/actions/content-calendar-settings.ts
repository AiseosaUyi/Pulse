"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { z } from "zod";
import type { ContentCalendarConfig } from "@/lib/content-calendar/config";

const inputSchema = z.object({
  niche: z.string().trim().min(1).max(80),
  interestTags: z.array(z.string().trim().min(1).max(60)).max(30),
});

type ActionResult =
  | { success: true }
  | { success: false; error: string };

/** Persist niche + interest tags into settings.contentCalendar (read-modify-write merge, same pattern as saveCadenceConfig). RLS gates write to owner/admin. */
export async function saveContentCalendarConfig(
  tenantSlug: string,
  input: ContentCalendarConfig
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
  const { error: writeError } = await supabase
    .from("tenants")
    .update({ settings: { ...existing, contentCalendar: parsed.data } })
    .eq("slug", tenantSlug);
  if (writeError) return { success: false, error: writeError.message };

  revalidatePath("/settings/content-calendar");
  revalidatePath("/content-calendar");
  return { success: true };
}
