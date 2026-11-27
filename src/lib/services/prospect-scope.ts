import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns `prospectId` only when that prospect belongs to `tenantSlug`, else
 * null. Callers run with the admin client (RLS bypassed), so a caller-supplied
 * prospect id must be checked before it is stored or followed, or one tenant
 * could link to, read, or mutate another tenant's prospect.
 */
export async function ownedProspectId(
  client: SupabaseClient,
  tenantSlug: string,
  prospectId: string | null | undefined
): Promise<string | null> {
  if (!prospectId) return null;
  const { data } = await client
    .from("prospects")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("id", prospectId)
    .maybeSingle();
  return data ? (data.id as string) : null;
}
