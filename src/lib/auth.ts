import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
}

export interface TenantMembership {
  slug: string;
  name: string;
  role: "owner" | "admin" | "member";
}

// Returns the logged-in user + profile, or null. Does not redirect.
export async function getCurrentUser(): Promise<UserProfile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email ?? "",
    username: profile?.username ?? null,
    displayName: profile?.display_name ?? null,
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
  const { data, error } = await supabase
    .from("memberships")
    .select("role, tenant_slug, tenants (slug, name)")
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
      };
    })
    .filter((x): x is TenantMembership => x !== null);
}

// Reads the tenant cookie, validates the user belongs to that tenant,
// falls back to first membership. Returns null if user has no memberships.
export async function getCurrentTenant(): Promise<TenantMembership | null> {
  const memberships = await getUserTenants();
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const cookieSlug = cookieStore.get("tenant")?.value;
  const match = memberships.find((m) => m.slug === cookieSlug);
  return match ?? memberships[0];
}
