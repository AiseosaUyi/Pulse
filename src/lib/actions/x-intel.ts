"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import type { XIntelConfig } from "@/lib/types/x-intel";

type ActionResult = { success: true } | { success: false; error: string };

export async function saveXIntelConfig(
  tenantSlug: string,
  config: XIntelConfig
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const keywords = config.keywords
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);

  const accounts = config.accounts
    .map((a) => a.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean)
    .slice(0, 30);

  const admin = createAdminClient();
  const { error } = await admin.rpc("jsonb_set_setting", {
    p_tenant_slug: tenantSlug,
    p_key: "x_intel_config",
    p_value: JSON.stringify({
      keywords,
      accounts,
      min_engagement: Math.max(0, Math.min(500, config.min_engagement ?? 15)),
      enabled: config.enabled,
    }),
  });

  if (error) {
    // Fall back to a direct update if the RPC isn't available.
    const supabase = await createClient();
    const { data: tenant } = await supabase
      .from("tenants")
      .select("settings")
      .eq("slug", tenantSlug)
      .single();

    const settings = (tenant?.settings as Record<string, unknown> | null) ?? {};
    const { error: updateError } = await admin
      .from("tenants")
      .update({
        settings: {
          ...settings,
          x_intel_config: {
            keywords,
            accounts,
            min_engagement: Math.max(0, Math.min(500, config.min_engagement ?? 15)),
            enabled: config.enabled,
          },
        },
      })
      .eq("slug", tenantSlug);

    if (updateError) return { success: false, error: updateError.message };
  }

  return { success: true };
}

export async function dismissXSignal(signalId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("x_signal_cards")
    .update({ dismissed_at: new Date().toISOString(), dismissed_by: user.id })
    .eq("id", signalId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
