"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setBrandPositioning, type BrandPositioning } from "@/lib/ai/brand-positioning";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

/**
 * RLS on `tenants` restricts updates to tenant owners/admins — we use
 * the user-scoped supabase client so unauthorized writes fail cleanly
 * with a Supabase error. Validation + the merge-write itself live in
 * setBrandPositioning, shared with the /api/v1/me POST route and
 * pulse_update_brand_voice MCP tool (which use the admin client instead,
 * since bearer-token/MCP auth has no session for RLS to key off).
 */
export async function updateBrandPositioning(
  tenantSlug: string,
  input: BrandPositioning
): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await setBrandPositioning(supabase, tenantSlug, input);
  if (!result.ok) return { success: false, error: result.error };

  revalidatePath("/settings");
  revalidatePath("/settings/brand-positioning");
  return { success: true };
}
