"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/features/registry";
import { writeFeatureSwitches } from "@/lib/features/server";

const schema = z.object({
  key: z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]),
  on: z.boolean(),
});

/**
 * Switch a feature on or off for the current workspace. Owners and admins
 * only. Switching off only hides it; no data is touched.
 */
export async function setFeatureAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Sign in again" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { ok: false, error: "Only owners and admins can change features" };
  }
  const r = await writeFeatureSwitches(createAdminClient(), tenant.slug, { [parsed.data.key]: parsed.data.on });
  if (r.error) return { ok: false, error: r.error };
  revalidatePath("/", "layout");
  return { ok: true };
}
