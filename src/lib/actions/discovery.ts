"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/auth";
import {
  DEFAULT_LIMITS,
  getDiscoveryConfig,
  type DiscoverySource,
  type TenantDiscoveryConfig,
} from "@/lib/scrape/discovery-config";

type ActionResult = { success: true } | { success: false; error: string };

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "source";
}

// Persist this tenant's platform-discovery sources into tenants.settings
// .discovery (JSONB). Owner/admin only. Each source is a label + crawl URLs +
// URL globs. Reusable for any vertical (ticketing, drinks, etc.).
export async function saveDiscoveryConfig(input: {
  enabled: boolean;
  sources: Array<{
    label: string;
    startUrls: string[];
    includeUrlGlobs: string[];
    excludeUrlGlobs?: string[];
  }>;
  limitPerSource?: number;
  maxCandidates?: number;
}): Promise<ActionResult> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { success: false, error: "Owners and admins only" };
  }

  const sources: DiscoverySource[] = input.sources
    .map((s) => ({
      id: slugify(s.label),
      label: s.label.trim(),
      startUrls: s.startUrls.map((u) => u.trim()).filter(Boolean),
      includeUrlGlobs: s.includeUrlGlobs.map((g) => g.trim()).filter(Boolean),
      excludeUrlGlobs: (s.excludeUrlGlobs ?? []).map((g) => g.trim()).filter(Boolean),
    }))
    .filter((s) => s.label && s.startUrls.length > 0 && s.includeUrlGlobs.length > 0);

  const config: TenantDiscoveryConfig = {
    enabled: input.enabled,
    signalType: "platform_discovery",
    limitPerSource: input.limitPerSource || DEFAULT_LIMITS.limitPerSource,
    maxCandidates: input.maxCandidates || DEFAULT_LIMITS.maxCandidates,
    sources,
  };

  const supabase = await createClient();
  const { data: row, error: readErr } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenant.slug)
    .single();
  if (readErr || !row) return { success: false, error: "Tenant not found" };

  const settings = (row.settings as Record<string, unknown> | null) ?? {};
  const { error } = await supabase
    .from("tenants")
    .update({ settings: { ...settings, discovery: config } })
    .eq("slug", tenant.slug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/settings/discovery");
  return { success: true };
}

// Read the effective config for the settings UI (includes Gruve's built-in
// default so the form shows what will actually run).
export async function getEffectiveDiscoveryConfig(): Promise<TenantDiscoveryConfig | null> {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("slug, settings")
    .eq("slug", tenant.slug)
    .single();
  if (!data) return null;
  return getDiscoveryConfig({
    slug: data.slug as string,
    settings: data.settings as Record<string, unknown> | null,
  });
}
