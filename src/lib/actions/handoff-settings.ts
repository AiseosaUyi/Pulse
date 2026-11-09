"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

const handoffStaleDaysSchema = z.object({
  days: z.coerce.number().int("Must be a whole number").min(1).max(90),
});

type ActionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Persist `handoffStaleAfterDays` into tenants.settings.
 *
 * Read-merge-write against the EXISTING settings object so sibling keys
 * (e.g. `sharedInbox`, `cadence`, `contentCalendar`, …) are preserved on
 * save.  Pattern matches saveSharedInboxConfig verbatim.
 */
export async function saveHandoffStaleDays(
  tenantSlug: string,
  days: number
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const parsed = handoffStaleDaysSchema.safeParse({ days });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" · "),
    };
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
    .update({
      settings: { ...existing, handoffStaleAfterDays: parsed.data.days },
    })
    .eq("slug", tenantSlug);
  if (writeError) return { success: false, error: writeError.message };

  revalidatePath("/settings/conversations");
  revalidatePath("/conversations");
  return { success: true };
}
