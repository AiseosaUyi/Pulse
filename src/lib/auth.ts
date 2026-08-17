import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export type AccountType = "startup" | "individual";

export interface TenantMembership {
  slug: string;
  name: string;
  role: "owner" | "admin" | "member" | "support";
  accountType: AccountType;
}

// Returns the logged-in user + profile, or null. Does not redirect.
export async function getCurrentUser(): Promise<UserProfile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, avatar_url")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email ?? "",
    username: profile?.username ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
}

// Redirects to /login if not authed. Returns the user.
export async function requireUser(): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// Returns all tenants the current user is a member of.
export async function getUserTenants(): Promise<TenantMembership[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Must filter by user_id explicitly: the memberships RLS policy lets you
  // read any membership in a tenant you belong to (so /settings/team can
  // display co-members). Without this filter the query would return Aise's
  // owner row to a user who's only a member of the same tenant.
  const { data, error } = await supabase
    .from("memberships")
    .select("role, tenant_slug, tenants (slug, name, account_type)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data
    .map((row) => {
      const t = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
      if (!t) return null;
      return {
        slug: t.slug,
        name: t.name,
        role: row.role as TenantMembership["role"],
        accountType: (t.account_type as AccountType) ?? "startup",
      };
    })
    .filter((x): x is TenantMembership => x !== null);
}

// Reads the tenant cookie, validates the user belongs to that tenant,
// falls back to an onboarded tenant (with brand voice) if no cookie is set,
// or first membership. Returns null if user has no memberships.
export async function getCurrentTenant(): Promise<TenantMembership | null> {
  const memberships = await getUserTenants();
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const cookieSlug = cookieStore.get("tenant")?.value;
  const match = memberships.find((m) => m.slug === cookieSlug);
  if (match) return match;

  // Fallback when no valid cookie is set: prefer a workspace that has already
  // completed onboarding (has brand voice) so a user logging in freshly
  // lands directly in their active workspace instead of an un-onboarded one.
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { data: tenantRows } = await admin
      .from("tenants")
      .select("slug, settings")
      .in("slug", memberships.map((m) => m.slug));

    if (tenantRows && tenantRows.length > 0) {
      const onboardedSlug = tenantRows.find(
        (t) => (t.settings as { brand_voice?: unknown } | null)?.brand_voice
      )?.slug;
      if (onboardedSlug) {
        const onboardedMatch = memberships.find((m) => m.slug === onboardedSlug);
        if (onboardedMatch) return onboardedMatch;
      }
    }
  } catch (err) {
    console.warn("[auth] getCurrentTenant fallback check failed", err);
  }

  return memberships[0];
}

// Guard for pages/actions that must reject a role outside `allowed` for the
// current tenant — e.g. a `support`-role member hitting a route the sidebar
// already hides them from, but that's still reachable by URL. Mirrors
// requireUser()'s redirect-based shape. This is a UI-layer second line of
// defense on top of migration 103's real RLS restriction, not a substitute
// for it — a route this guards still relies on RLS to actually deny the
// underlying data access if the guard is ever missed on some call path.
export async function requireTenantRole(
  allowed: TenantMembership["role"][]
): Promise<TenantMembership> {
  const tenant = await getCurrentTenant();
  if (!tenant || !allowed.includes(tenant.role)) {
    redirect("/dashboard");
  }
  return tenant;
}
