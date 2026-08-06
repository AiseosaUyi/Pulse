"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant } from "@/lib/auth";
import { siteBaseUrlFromDomain } from "@/lib/seo/tenant-seo-config";

type ActionResult = { success: true } | { success: false; error: string };

// Persists this tenant's live/staging site domains + blog route prefix into
// tenants.settings (read-merge-write, same pattern as discovery.ts/cadence.ts
// — never replace the settings object wholesale, or unrelated keys like
// audienceConfig/platforms silently vanish). Consumed by
// src/lib/seo/tenant-seo-config.ts, which every publish path (blog + SEO
// programmatic pages) resolves live/staging URLs through. This is the ONLY
// place these three values should ever be written — no tenant-slug hardcoded
// fallback exists anymore, so a wrong or missing value here shows up
// immediately as a wrong publish link, which is exactly why this needs to be
// user-editable instead of baked into code.
export async function saveSiteDomainConfig(input: {
  domain: string;
  stagingDomain: string;
  blogPathPrefix: string;
}): Promise<ActionResult> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { success: false, error: "Owners and admins only" };
  }

  const domain = input.domain.trim();
  const stagingDomain = input.stagingDomain.trim();
  const blogPathPrefix = input.blogPathPrefix.trim() || "/blog";

  if (domain && !siteBaseUrlFromDomain(domain)) {
    return { success: false, error: `"${domain}" doesn't look like a valid domain or URL.` };
  }
  if (stagingDomain && !siteBaseUrlFromDomain(stagingDomain)) {
    return { success: false, error: `"${stagingDomain}" doesn't look like a valid domain or URL.` };
  }
  if (!blogPathPrefix.startsWith("/")) {
    return { success: false, error: "Blog path prefix must start with /, e.g. /blog" };
  }

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
    .update({ settings: { ...settings, domain, stagingDomain, blogPathPrefix } })
    .eq("slug", tenant.slug);
  if (error) return { success: false, error: error.message };

  revalidatePath("/settings/integrations");
  revalidatePath("/seo-tracker/blog-writer");
  return { success: true };
}
