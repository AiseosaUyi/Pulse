import { NextResponse } from "next/server";
import { verifyOAuthState, appUrl } from "@/lib/integrations/platform-oauth";
import { exchangeTikTokAdsCode, listTikTokAdvertisers } from "@/lib/integrations/tiktok-ads";
import { upsertTikTokAdsConnection, getTikTokAdsConnection } from "@/lib/services/tiktok-ads-connections";
import { upsertAdAccount } from "@/lib/services/ad-accounts";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const authCode = url.searchParams.get("auth_code") ?? url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(appUrl(`/settings/integrations?error=${encodeURIComponent(oauthError)}`));
  }
  if (!authCode || !state) {
    return NextResponse.redirect(appUrl("/settings/integrations?error=missing_code"));
  }
  const verified = await verifyOAuthState("tiktok_ads", state);
  if (!verified) {
    return NextResponse.redirect(appUrl("/settings/integrations?error=state_mismatch"));
  }

  try {
    const tokens = await exchangeTikTokAdsCode(authCode);
    const advertisers = await listTikTokAdvertisers(tokens.accessToken);
    // A single auth grant can cover multiple ad accounts under one Business
    // Center — store one connection row per advertiser, all sharing the
    // same access token (matches TikTok's own multi-advertiser grant model).
    const targets = advertisers.length > 0 ? advertisers : tokens.advertiserIds.map((id) => ({ advertiserId: id, advertiserName: null, currency: null, timezone: null }));

    for (const adv of targets) {
      await upsertTikTokAdsConnection({
        tenantSlug: verified.tenantSlug,
        advertiserId: adv.advertiserId,
        advertiserName: adv.advertiserName,
        tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        createdBy: verified.userId,
      });
      const conn = await getTikTokAdsConnection(verified.tenantSlug, adv.advertiserId);
      await upsertAdAccount({
        tenantSlug: verified.tenantSlug,
        platform: "tiktok",
        externalAccountId: adv.advertiserId,
        accountName: adv.advertiserName,
        currency: adv.currency ?? "NGN",
        timezone: adv.timezone,
        tiktokConnectionId: conn?.id ?? null,
      });
    }

    return NextResponse.redirect(appUrl("/settings/integrations?connected=tiktok_ads"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(appUrl(`/settings/integrations?error=${encodeURIComponent(msg)}`));
  }
}
