// Read the tenant's cadence config out of settings.cadence. Mirrors the
// getBrandVoice / getBrandPositioning readers (admin client, parse-or-null).

import { createAdminClient } from "@/lib/supabase/admin";
import { cadenceConfigSchema, type CadenceConfig } from "./types";

export async function getCadenceConfig(
  tenantSlug: string
): Promise<CadenceConfig | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (error || !data?.settings) return null;
  const parsed = cadenceConfigSchema.safeParse(
    (data.settings as { cadence?: unknown }).cadence
  );
  return parsed.success ? parsed.data : null;
}
