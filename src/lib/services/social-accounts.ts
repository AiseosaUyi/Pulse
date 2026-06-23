// Maps tenant+platform → SocialAPI account ID.
// Stored in platform_connections.platform_user_id (the SocialAPI account id like "acc_ig_xxx").
// No OAuth tokens stored — SocialAPI manages auth on their end.

import { createAdminClient } from "@/lib/supabase/admin";
import { listAccounts } from "@/lib/integrations/socialapi";
import type { SocialPlatform } from "@/lib/integrations/socialapi";

export type { SocialPlatform };

export interface ConnectedSocialAccount {
  id: string;           // SocialAPI account id
  platform: string;
  username: string;
  name: string;
  profilePictureUrl?: string;
  tenantSlug: string;
}

/** Get the SocialAPI account ID for a tenant+platform — used at publish time */
export async function getSocialAccountId(
  tenantSlug: string,
  platform: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_connections")
    .select("platform_user_id")
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform)
    .single();
  return data?.platform_user_id ?? null;
}

/** Save a SocialAPI account ID mapping for a tenant+platform */
export async function saveSocialAccountMapping(params: {
  tenantSlug: string;
  platform: string;
  socialApiAccountId: string;
  username: string;
  name: string;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("platform_connections").upsert(
    {
      tenant_slug: params.tenantSlug,
      platform: params.platform,
      platform_user_id: params.socialApiAccountId,
      platform_handle: params.username ? `@${params.username}` : params.name,
      // No tokens — SocialAPI manages auth
      access_token_enc: "socialapi-managed",
      scopes: [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_slug,platform" }
  );
}

/** Remove a mapping */
export async function removeSocialAccountMapping(
  tenantSlug: string,
  platform: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("platform_connections")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform);
}

/** Fetch all accounts from SocialAPI and return them (used in settings page to let user pick) */
export async function fetchAllSocialApiAccounts() {
  const accounts = await listAccounts();
  return accounts.map((a) => ({
    id: a.id,
    platform: a.platform.toLowerCase(),
    username: a.username,
    name: a.name,
    profilePictureUrl: a.profile_picture_url,
  }));
}

/** Get all saved mappings for a tenant */
export async function getTenantSocialMappings(tenantSlug: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_connections")
    .select("platform, platform_user_id, platform_handle")
    .eq("tenant_slug", tenantSlug);
  return (data ?? []).map((r) => ({
    platform: r.platform,
    socialApiAccountId: r.platform_user_id,
    handle: r.platform_handle,
  }));
}
