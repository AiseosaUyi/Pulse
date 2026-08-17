"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { sharedInboxConfigSchema, type SharedInboxConfig } from "@/lib/shared-inbox/types";

type ActionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Persist AI-away-coverage config into settings.sharedInbox. Read-merge-write
 * against the EXISTING settings object — same pattern as
 * content-calendar-settings.ts's saveContentCalendarConfig, not raw SQL
 * jsonb_set (unused/drifted in this repo). Merging at the top-level settings
 * key (not inside sharedInbox itself, which has no other subfields to
 * preserve) is what keeps sibling keys like `cadence`/`contentCalendar`
 * intact on save.
 */
export async function saveSharedInboxConfig(
  tenantSlug: string,
  input: SharedInboxConfig
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const parsed = sharedInboxConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(" · ") };
  }
  // Window ids must be unique, else the editor's per-window patch/remove
  // handlers collide (same reasoning as cadence's window-id uniqueness check).
  const ids = parsed.data.officeHours.map((w) => w.id);
  if (new Set(ids).size !== ids.length) {
    return { success: false, error: "Each office-hours window needs a unique id." };
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
    .update({ settings: { ...existing, sharedInbox: parsed.data } })
    .eq("slug", tenantSlug);
  if (writeError) return { success: false, error: writeError.message };

  revalidatePath("/settings/conversations");
  revalidatePath("/conversations");
  return { success: true };
}
