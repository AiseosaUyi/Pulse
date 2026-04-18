"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  brandPositioningSchema,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

/**
 * Merge-write the user's brand positioning into `tenants.settings`
 * WITHOUT clobbering any other keys (especially `brand_voice`). Same
 * read-modify-write pattern used by `updateBrandVoice` in briefs.ts.
 *
 * RLS on `tenants` restricts updates to tenant owners/admins — we use
 * the user-scoped supabase client so unauthorized writes fail
 * cleanly with a Supabase error.
 */
export async function updateBrandPositioning(
  tenantSlug: string,
  input: BrandPositioning
): Promise<ActionResult> {
  const parsed = brandPositioningSchema.safeParse(input);
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

  if (readError) {
    return { success: false, error: readError.message };
  }

  const existing = (tenant?.settings as Record<string, unknown>) ?? {};
  const merged = {
    ...existing,
    brand_positioning: parsed.data,
  };

  const { error: writeError } = await supabase
    .from("tenants")
    .update({ settings: merged })
    .eq("slug", tenantSlug);

  if (writeError) {
    return { success: false, error: writeError.message };
  }

  revalidatePath("/settings");
  revalidatePath("/settings/brand-positioning");
  return { success: true };
}
