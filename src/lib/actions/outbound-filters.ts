"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { outboundFiltersSchema } from "@/lib/validation/outbound-filters";
import {
  DEFAULT_OUTBOUND_FILTERS,
  type OutboundFilters,
} from "@/lib/types/outbound-filters";

type ActionResult =
  | { success: true; filters: OutboundFilters }
  | { success: false; error: string };

export async function updateOutboundFilters(
  tenantSlug: string,
  patch: Partial<OutboundFilters>
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: tenant, error: readErr } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .single();
  if (readErr || !tenant) return { success: false, error: "Tenant not found" };

  const settings =
    (tenant.settings as Record<string, unknown> | null) ?? {};
  const existingFilters =
    (settings.outbound_filters as Partial<OutboundFilters> | undefined) ?? {};

  const merged: OutboundFilters = {
    ...DEFAULT_OUTBOUND_FILTERS,
    ...existingFilters,
    ...patch,
  };

  const normalized: OutboundFilters = {
    ...merged,
    keywords: merged.keywords
      .map((k) => k.trim().replace(/^[#@]/, "").toLowerCase())
      .filter(Boolean),
    competitorUrls: merged.competitorUrls
      .map((u) =>
        u
          .trim()
          .replace(/^https?:\/\//i, "")
          .replace(/\/+$/, "")
          .toLowerCase()
      )
      .filter(Boolean),
    geoScope: merged.geoScope
      .map((g) => ({
        country: g.country.trim(),
        states: (g.states ?? []).map((s) => s.trim()).filter(Boolean),
      }))
      .filter((g) => g.country.length > 0),
  };

  const validation = outboundFiltersSchema.safeParse(normalized);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.issues.map((i) => i.message).join(", "),
    };
  }

  const newSettings = { ...settings, outbound_filters: validation.data };

  const { error } = await supabase
    .from("tenants")
    .update({ settings: newSettings })
    .eq("slug", tenantSlug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/settings/outbound-filters");
  return { success: true, filters: validation.data };
}
