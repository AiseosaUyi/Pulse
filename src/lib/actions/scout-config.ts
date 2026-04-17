"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult =
  | { success: true }
  | { success: false; error: string };

export async function updateScoutConfig(
  tenantSlug: string,
  patch: { instagram_hashtags?: string[]; tiktok_hashtags?: string[] }
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: tenant, error: readErr } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .single();
  if (readErr || !tenant) return { success: false, error: "Tenant not found" };

  const settings = (tenant.settings as Record<string, unknown> | null) ?? {};
  const scoutConfig = {
    ...((settings.scout_config as Record<string, unknown> | undefined) ?? {}),
    ...(patch.instagram_hashtags !== undefined && {
      instagram_hashtags: patch.instagram_hashtags
        .map((h) => h.trim().replace(/^#/, ""))
        .filter(Boolean),
    }),
    ...(patch.tiktok_hashtags !== undefined && {
      tiktok_hashtags: patch.tiktok_hashtags
        .map((h) => h.trim().replace(/^#/, ""))
        .filter(Boolean),
    }),
  };
  const newSettings = { ...settings, scout_config: scoutConfig };

  const { error } = await supabase
    .from("tenants")
    .update({ settings: newSettings })
    .eq("slug", tenantSlug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/settings/trend-scouts");
  return { success: true };
}
