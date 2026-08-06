import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tenant, AudienceConfig, PlatformConnection } from "@/lib/types/tenant";

interface TenantSettings {
  domain?: string;
  stagingDomain?: string;
  blogPathPrefix?: string;
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
    stagingDomain: s.stagingDomain ?? "",
    blogPathPrefix: s.blogPathPrefix ?? "/blog",
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

/** Sparse `{slug, name}` lookup for callers that only need those two
 * fields under token auth — `getTenant()` itself hardcodes the SSR/RLS
 * client and has ~30 call sites across the app, too invasive to
 * refactor for client injection in this PR. Shared by /api/v1/me,
 * draft-dm, reply-draft, and their MCP tool equivalents. */
export async function getTenantMeta(
  client: SupabaseClient,
  slug: string
): Promise<{ slug: string; name: string } | null> {
  const { data } = await client
    .from("tenants")
    .select("slug, name")
    .eq("slug", slug)
    .maybeSingle();
  return data ?? null;
}

export async function getTenant(slug: string): Promise<Tenant | null> {
  let data: { slug: string; name: string; settings: TenantSettings | null; created_at: string } | null = null;
  try {
    const supabase = await createClient();
    const res = await supabase
      .from("tenants")
      .select("slug, name, settings, created_at")
      .eq("slug", slug)
      .maybeSingle();
    data = res.data;
  } catch {
    // Session-less context (e.g. cron, background publish runner, standalone script)
  }

  if (!data) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const res = await admin
      .from("tenants")
      .select("slug, name, settings, created_at")
      .eq("slug", slug)
      .maybeSingle();
    data = res.data;
  }

  if (!data) return null;
  return hydrate(data);
}
