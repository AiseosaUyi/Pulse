// tiktok_ads_connections CRUD — mirrors platform-connections.ts exactly
// (same encryption scheme, same admin-client-only access pattern) but
// deliberately a separate table/service: TikTok Ads is a different app,
// scope, and Advertiser-ID hierarchy than TikTok social publishing.

import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, decryptToken } from "@/lib/integrations/platform-crypto";

export interface TikTokAdsTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

export interface TikTokAdsConnection {
  id: string;
  tenantSlug: string;
  advertiserId: string;
  advertiserName: string | null;
  status: "active" | "expired" | "revoked";
  lastSyncedAt: string | null;
  lastError: string | null;
}

export async function upsertTikTokAdsConnection(params: {
  tenantSlug: string;
  advertiserId: string;
  advertiserName?: string | null;
  tokens: TikTokAdsTokens;
  createdBy?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("tiktok_ads_connections").upsert(
    {
      tenant_slug: params.tenantSlug,
      advertiser_id: params.advertiserId,
      advertiser_name: params.advertiserName ?? null,
      access_token_enc: encryptToken(params.tokens.accessToken),
      refresh_token_enc: params.tokens.refreshToken ? encryptToken(params.tokens.refreshToken) : null,
      expires_at: params.tokens.expiresAt?.toISOString() ?? null,
      scopes: params.tokens.scopes ?? [],
      status: "active",
      last_error: null,
      created_by: params.createdBy ?? null,
    },
    { onConflict: "tenant_slug,advertiser_id" }
  );
  if (error) throw new Error(`upsertTikTokAdsConnection: ${error.message}`);
}

export async function getTikTokAdsConnection(
  tenantSlug: string,
  advertiserId: string
): Promise<(TikTokAdsConnection & { accessToken: string; refreshToken?: string; expiresAt: Date | null }) | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tiktok_ads_connections")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("advertiser_id", advertiserId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    tenantSlug: data.tenant_slug,
    advertiserId: data.advertiser_id,
    advertiserName: data.advertiser_name,
    status: data.status,
    lastSyncedAt: data.last_synced_at,
    lastError: data.last_error,
    accessToken: decryptToken(data.access_token_enc),
    refreshToken: data.refresh_token_enc ? decryptToken(data.refresh_token_enc) : undefined,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
  };
}

export async function listTikTokAdsConnectionsForTenant(tenantSlug: string): Promise<TikTokAdsConnection[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tiktok_ads_connections")
    .select("id, tenant_slug, advertiser_id, advertiser_name, status, last_synced_at, last_error")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id,
    tenantSlug: r.tenant_slug,
    advertiserId: r.advertiser_id,
    advertiserName: r.advertiser_name,
    status: r.status,
    lastSyncedAt: r.last_synced_at,
    lastError: r.last_error,
  }));
}

export async function listActiveTikTokAdsConnections(): Promise<
  Array<TikTokAdsConnection & { accessToken: string }>
> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tiktok_ads_connections")
    .select("*")
    .eq("status", "active");
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    tenantSlug: r.tenant_slug,
    advertiserId: r.advertiser_id,
    advertiserName: r.advertiser_name,
    status: r.status,
    lastSyncedAt: r.last_synced_at,
    lastError: r.last_error,
    accessToken: decryptToken(r.access_token_enc),
  }));
}

export async function markTikTokAdsConnectionSynced(id: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("tiktok_ads_connections").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", id);
}

export async function markTikTokAdsConnectionError(id: string, error: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("tiktok_ads_connections").update({ last_error: error }).eq("id", id);
}

export async function disconnectTikTokAds(tenantSlug: string, id: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("tiktok_ads_connections")
    .update({ status: "revoked" })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
}
