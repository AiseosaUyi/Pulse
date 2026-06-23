// Platform connections CRUD — all reads/writes use admin client (service-role)
// so they bypass RLS and work from webhooks, crons, and OAuth callbacks alike.

import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, decryptToken } from "@/lib/integrations/platform-crypto";

export type OAuthPlatform = "x" | "linkedin" | "instagram" | "tiktok" | "youtube";

export interface PlatformTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

export interface PlatformConnection {
  id: string;
  tenantSlug: string;
  platform: OAuthPlatform;
  platformUserId: string;
  platformHandle: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export async function upsertPlatformConnection(params: {
  tenantSlug: string;
  platform: OAuthPlatform;
  platformUserId: string;
  platformHandle?: string | null;
  tokens: PlatformTokens;
}): Promise<void> {
  const admin = createAdminClient();
  const { tenantSlug, platform, platformUserId, platformHandle, tokens } = params;
  const { error } = await admin.from("platform_connections").upsert(
    {
      tenant_slug: tenantSlug,
      platform,
      platform_user_id: platformUserId,
      platform_handle: platformHandle ?? null,
      access_token_enc: encryptToken(tokens.accessToken),
      refresh_token_enc: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
      expires_at: tokens.expiresAt?.toISOString() ?? null,
      scopes: tokens.scopes ?? [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_slug,platform" }
  );
  if (error) throw new Error(`upsertPlatformConnection: ${error.message}`);
}

export async function getPlatformConnection(
  tenantSlug: string,
  platform: OAuthPlatform
): Promise<(PlatformConnection & { accessToken: string; refreshToken?: string }) | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_connections")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform)
    .single();
  if (!data) return null;
  return {
    id: data.id,
    tenantSlug: data.tenant_slug,
    platform: data.platform as OAuthPlatform,
    platformUserId: data.platform_user_id,
    platformHandle: data.platform_handle,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
    scopes: data.scopes ?? [],
    accessToken: decryptToken(data.access_token_enc),
    refreshToken: data.refresh_token_enc ? decryptToken(data.refresh_token_enc) : undefined,
  };
}

export async function getAllPlatformConnections(tenantSlug: string): Promise<PlatformConnection[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_connections")
    .select("id, tenant_slug, platform, platform_user_id, platform_handle, expires_at, scopes")
    .eq("tenant_slug", tenantSlug)
    .order("platform");
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    tenantSlug: r.tenant_slug,
    platform: r.platform as OAuthPlatform,
    platformUserId: r.platform_user_id,
    platformHandle: r.platform_handle,
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
    scopes: r.scopes ?? [],
  }));
}

export async function deletePlatformConnection(
  tenantSlug: string,
  platform: OAuthPlatform
): Promise<void> {
  const admin = createAdminClient();
  // Mark any scheduled posts for this connection as failed
  await admin
    .from("scheduled_posts")
    .update({
      status: "failed",
      error_message: "Connection disconnected before post could publish.",
    })
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform)
    .eq("status", "scheduled");

  await admin
    .from("platform_connections")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform);
}

// Returns connections expiring within the next N days
export async function getExpiringConnections(
  daysAhead: number
): Promise<Array<PlatformConnection & { ownerEmail?: string }>> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("platform_connections")
    .select("id, tenant_slug, platform, platform_user_id, platform_handle, expires_at, scopes")
    .not("expires_at", "is", null)
    .lt("expires_at", cutoff);
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    tenantSlug: r.tenant_slug,
    platform: r.platform as OAuthPlatform,
    platformUserId: r.platform_user_id,
    platformHandle: r.platform_handle,
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
    scopes: r.scopes ?? [],
  }));
}
