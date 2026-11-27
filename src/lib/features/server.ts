// Server side of feature switches: read tenants.settings.features, decide any
// key never set by looking for data, and remember that decision so the probe
// runs once per workspace, not on every page load.

import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { FEATURES, resolveFeatures, type FeatureKey } from "./registry";

type Stored = Partial<Record<FeatureKey, boolean>>;

/** true = has rows, false = none, null = could not tell. */
async function probe(admin: SupabaseClient, slug: string, key: FeatureKey): Promise<boolean | null> {
  const def = FEATURES.find((f) => f.key === key)!;
  let unknown = false;
  for (const p of def.probes) {
    const { count, error } = await admin
      .from(p.table)
      .select("*", { count: "exact", head: true })
      .eq(p.tenantColumn, slug);
    if (error) {
      unknown = true;
      continue;
    }
    if ((count ?? 0) > 0) return true;
  }
  return unknown ? null : false;
}

async function readStored(admin: SupabaseClient, slug: string): Promise<{ settings: Record<string, unknown>; stored: Stored }> {
  const { data } = await admin.from("tenants").select("settings").eq("slug", slug).maybeSingle();
  const settings = (data?.settings as Record<string, unknown>) ?? {};
  const stored = (settings.features as Stored | undefined) ?? {};
  return { settings, stored };
}

/** Read-merge-write of settings.features only; sibling keys are kept. */
export async function writeFeatureSwitches(admin: SupabaseClient, slug: string, patch: Stored): Promise<{ error?: string }> {
  const { settings, stored } = await readStored(admin, slug);
  const { error } = await admin
    .from("tenants")
    .update({ settings: { ...settings, features: { ...stored, ...patch } } })
    .eq("slug", slug);
  return error ? { error: error.message } : {};
}

export async function loadFeatures(admin: SupabaseClient, slug: string): Promise<Record<FeatureKey, boolean>> {
  const { stored } = await readStored(admin, slug);
  const missing = FEATURES.filter((f) => typeof stored[f.key] !== "boolean").map((f) => f.key);
  if (missing.length === 0) return resolveFeatures(stored, {});

  const hasData: Partial<Record<FeatureKey, boolean | null>> = {};
  await Promise.all(missing.map(async (k) => (hasData[k] = await probe(admin, slug, k))));
  const resolved = resolveFeatures(stored, hasData);

  // Remember only confident answers; a failed check is retried next time.
  const decided: Stored = {};
  for (const k of missing) if (hasData[k] !== null) decided[k] = resolved[k];
  if (Object.keys(decided).length) await writeFeatureSwitches(admin, slug, decided).catch(() => undefined);
  return resolved;
}

/** Per-request cached. Use in layouts and pages. */
export const getFeatures = cache(async (slug: string) => loadFeatures(createAdminClient(), slug));

export async function isFeatureOn(slug: string, key: FeatureKey): Promise<boolean> {
  return (await getFeatures(slug))[key];
}
