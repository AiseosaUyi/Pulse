// Daily cron: syncs campaign/ad-set/ad/creative structure for every active
// ad account (Meta + TikTok) into ad_campaigns/ad_sets/ads/ad_creatives.
// Structure changes rarely relative to spend — daily is enough; see
// sync-ad-insights for the tighter-cadence performance sync.

import { createAdminClient } from "@/lib/supabase/admin";
import { listActiveAdAccounts, markAdAccountSynced, markAdAccountSyncError } from "@/lib/services/ad-accounts";
import { upsertCampaigns, upsertAdSets, upsertCreatives, upsertAds } from "@/lib/services/ads-sync";
import { resolveConnectionById } from "@/lib/composio/resolve-alias";
import { listMetaCampaigns, listMetaAds, listMetaAdCreatives } from "@/lib/composio/ads-executors";
import { decryptToken } from "@/lib/integrations/platform-crypto";
import { listTikTokCampaigns, listTikTokAdGroups, listTikTokAds } from "@/lib/integrations/tiktok-ads";

export const maxDuration = 300;

async function syncMetaAccount(
  tenantSlug: string,
  adAccountId: string,
  externalAccountId: string,
  connectedAccountId: string | null
): Promise<void> {
  if (!connectedAccountId) throw new Error("Meta ad account has no connected_account_id");
  const conn = await resolveConnectionById(connectedAccountId);
  if (!conn) throw new Error("Meta connection is no longer active");

  const { campaigns, adSets } = await listMetaCampaigns(conn, externalAccountId);
  const campaignIdByExternalId = await upsertCampaigns(tenantSlug, adAccountId, campaigns);
  const adSetIdByExternalId = await upsertAdSets(tenantSlug, campaignIdByExternalId, adSets);

  const creatives = await listMetaAdCreatives(conn, externalAccountId);
  const creativeIdByExternalId = await upsertCreatives(tenantSlug, adAccountId, creatives);

  const ads = await listMetaAds(conn, externalAccountId);
  await upsertAds(tenantSlug, adSetIdByExternalId, creativeIdByExternalId, ads);
}

async function syncTikTokAccount(
  tenantSlug: string,
  adAccountId: string,
  externalAccountId: string,
  tiktokConnectionId: string | null
): Promise<void> {
  if (!tiktokConnectionId) throw new Error("TikTok ad account has no tiktok_connection_id");
  const admin = createAdminClient();
  const { data: connRow } = await admin
    .from("tiktok_ads_connections")
    .select("access_token_enc, status")
    .eq("id", tiktokConnectionId)
    .maybeSingle();
  if (!connRow || connRow.status !== "active") throw new Error("TikTok connection is no longer active");
  const accessToken = decryptToken(connRow.access_token_enc);

  const campaigns = await listTikTokCampaigns(accessToken, externalAccountId);
  const campaignIdByExternalId = await upsertCampaigns(tenantSlug, adAccountId, campaigns);

  const adSets = await listTikTokAdGroups(accessToken, externalAccountId);
  const adSetIdByExternalId = await upsertAdSets(tenantSlug, campaignIdByExternalId, adSets);

  const { ads, creatives } = await listTikTokAds(accessToken, externalAccountId);
  const creativeIdByExternalId = await upsertCreatives(tenantSlug, adAccountId, creatives);
  await upsertAds(tenantSlug, adSetIdByExternalId, creativeIdByExternalId, ads);
}

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await listActiveAdAccounts();
  let synced = 0;
  let errors = 0;

  for (const acc of accounts) {
    try {
      if (acc.platform === "meta") {
        const admin = createAdminClient();
        const { data } = await admin.from("ad_accounts").select("connected_account_id").eq("id", acc.id).single();
        await syncMetaAccount(acc.tenantSlug, acc.id, acc.externalAccountId, data?.connected_account_id ?? null);
      } else {
        const admin = createAdminClient();
        const { data } = await admin.from("ad_accounts").select("tiktok_connection_id").eq("id", acc.id).single();
        await syncTikTokAccount(acc.tenantSlug, acc.id, acc.externalAccountId, data?.tiktok_connection_id ?? null);
      }
      await markAdAccountSynced(acc.id, "structure");
      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[sync-ad-structure] failed for account", acc.id, msg);
      await markAdAccountSyncError(acc.id, msg);
      errors++;
    }
  }

  return Response.json({ synced, errors, total: accounts.length });
}
