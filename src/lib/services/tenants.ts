import { createClient } from "@/lib/supabase/server";
import type { Tenant, AudienceConfig, PlatformConnection } from "@/lib/types/tenant";

interface TenantSettings {
  domain?: string;
  currency?: string;
  audienceConfig?: AudienceConfig;
  platforms?: PlatformConnection[];
  blogCategories?: string[];
}

const DEFAULT_AUDIENCE: AudienceConfig = {
  primaryRegions: [],
  expandedRegions: [],
  targetDemographics: [],
};

function hydrate(row: {
  slug: string;
  name: string;
  settings: TenantSettings | null;
  created_at: string;
}): Tenant {
  const s = row.settings ?? {};
  return {
    id: `t_${row.slug}`,
    slug: row.slug,
    name: row.name,
    domain: s.domain ?? "",
    currency: s.currency ?? "USD",
    audienceConfig: s.audienceConfig ?? DEFAULT_AUDIENCE,
    platforms: s.platforms ?? [],
    blogCategories: s.blogCategories ?? [],
    createdAt: new Date(row.created_at),
  };
}

export async function getTenants(): Promise<Tenant[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("slug, name, settings, created_at")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map(hydrate);
}

export async function getTenant(slug: string): Promise<Tenant | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("slug, name, settings, created_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return hydrate(data);
}
