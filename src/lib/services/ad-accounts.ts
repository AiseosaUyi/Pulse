// Unified ad_accounts registry — one row per real ad account regardless of
// platform or which connection mechanism (Composio for Meta, direct OAuth
// for TikTok) owns its credentials. Every downstream ads table joins here.

import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, decryptToken } from "@/lib/integrations/platform-crypto";
import type { AdAccountRecord, AdPlatformKind } from "@/lib/types/ads-platform";

function rowTo(r: Record<string, unknown>): AdAccountRecord {
  return {
    id: r.id as string,
    tenantSlug: r.tenant_slug as string,
    platform: r.platform as AdPlatformKind,
    externalAccountId: r.external_account_id as string,
    accountName: (r.account_name as string) ?? null,
    currency: r.currency as string,
    timezone: (r.timezone as string) ?? null,
    status: r.status as AdAccountRecord["status"],
    lastSyncedAt: (r.last_synced_at as string) ?? null,
    lastInsightsSyncedAt: (r.last_insights_synced_at as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    createdAt: r.created_at as string,
    metaPixelId: (r.meta_pixel_id as string) ?? null,
    metaCapiConfigured: Boolean(r.meta_capi_token_enc),
    tiktokPixelCode: (r.tiktok_pixel_code as string) ?? null,
  };
}

export async function upsertAdAccount(params: {
  tenantSlug: string;
  platform: AdPlatformKind;
  externalAccountId: string;
  accountName?: string | null;
  currency?: string;
  timezone?: string | null;
  connectedAccountId?: string | null; // Meta (Composio) connection
  tiktokConnectionId?: string | null; // TikTok (direct) connection
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("ad_accounts").upsert(
    {
      tenant_slug: params.tenantSlug,
      platform: params.platform,
      external_account_id: params.externalAccountId,
      account_name: params.accountName ?? null,
      currency: params.currency ?? "NGN",
      timezone: params.timezone ?? null,
      connected_account_id: params.connectedAccountId ?? null,
      tiktok_connection_id: params.tiktokConnectionId ?? null,
      status: "active",
      last_error: null,
    },
    { onConflict: "tenant_slug,platform,external_account_id" }
  );
  if (error) throw new Error(`upsertAdAccount: ${error.message}`);
}

export async function listAdAccountsForTenant(tenantSlug: string): Promise<AdAccountRecord[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ad_accounts")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false });
  return (data ?? []).map(rowTo);
}

export async function listActiveAdAccounts(platform?: AdPlatformKind): Promise<AdAccountRecord[]> {
  const admin = createAdminClient();
  let query = admin.from("ad_accounts").select("*").eq("status", "active");
  if (platform) query = query.eq("platform", platform);
  const { data } = await query;
  return (data ?? []).map(rowTo);
}

export async function markAdAccountSynced(id: string, kind: "structure" | "insights"): Promise<void> {
  const admin = createAdminClient();
  const field = kind === "structure" ? "last_synced_at" : "last_insights_synced_at";
  await admin
    .from("ad_accounts")
    .update({ [field]: new Date().toISOString(), last_error: null })
    .eq("id", id);
}

/** Flips the account to 'error' status — removes it from future active-only
 *  sync passes until reconnected. Use only for confirmed auth/permission
 *  failures (revoked token, lost access), not transient API errors. */
export async function markAdAccountError(id: string, error: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ad_accounts").update({ status: "error", last_error: error }).eq("id", id);
}

/** Records a sync failure without disabling the account — a rate limit or
 *  timeout shouldn't stop future sync attempts, only a confirmed auth
 *  failure should (see markAdAccountError). */
export async function markAdAccountSyncError(id: string, error: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ad_accounts").update({ last_error: error }).eq("id", id);
}

/** CAPI/Events API config (migration 096) is manually entered per ad
 *  account, separate from the ads-management OAuth connection — see that
 *  migration's header comment for why. `undefined` leaves a field
 *  untouched; `null`/"" clears it. The raw Meta token is encrypted before
 *  storage, same scheme as every other stored platform token. */
export async function updateAdAccountPixelConfig(params: {
  tenantSlug: string;
  adAccountId: string;
  metaPixelId?: string | null;
  metaCapiToken?: string | null;
  tiktokPixelCode?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if (params.metaPixelId !== undefined) update.meta_pixel_id = params.metaPixelId || null;
  if (params.metaCapiToken !== undefined) update.meta_capi_token_enc = params.metaCapiToken ? encryptToken(params.metaCapiToken) : null;
  if (params.tiktokPixelCode !== undefined) update.tiktok_pixel_code = params.tiktokPixelCode || null;
  if (Object.keys(update).length === 0) return;

  const { error } = await admin
    .from("ad_accounts")
    .update(update)
    .eq("id", params.adAccountId)
    .eq("tenant_slug", params.tenantSlug);
  if (error) throw new Error(`updateAdAccountPixelConfig: ${error.message}`);
}

/** Meta's webhook subscribe call needs a raw access token with
 *  ads_management scope on the ad account — Composio can't expose Meta's
 *  opaque OAuth token, so this reuses the manually-entered CAPI System User
 *  token (see meta-capi.ts subscribeMetaAdAccountWebhook doc comment).
 *  Returns null if no CAPI token is configured yet for this account. */
export async function getMetaAdAccountWebhookCredentials(
  tenantSlug: string,
  adAccountId: string
): Promise<{ externalAccountId: string; accessToken: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ad_accounts")
    .select("external_account_id, platform, meta_capi_token_enc")
    .eq("id", adAccountId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (!data || data.platform !== "meta" || !data.meta_capi_token_enc) return null;
  return { externalAccountId: data.external_account_id, accessToken: decryptToken(data.meta_capi_token_enc) };
}

/** Marks every ad account backed by a given TikTok Ads connection as
 *  disabled, so a revoked connection stops appearing in active-only sync
 *  passes immediately rather than lingering with stale data until the next
 *  sync attempt fails. */
export async function disableAdAccountsByTikTokConnection(tenantSlug: string, tiktokConnectionId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("ad_accounts")
    .update({ status: "disabled" })
    .eq("tenant_slug", tenantSlug)
    .eq("tiktok_connection_id", tiktokConnectionId);
}
