import { NextResponse } from "next/server";
import { verifyOAuthState, appUrl } from "@/lib/integrations/platform-oauth";
import { exchangeTikTokCode, fetchTikTokUser } from "@/lib/integrations/platforms/tiktok";
import { upsertPlatformConnection } from "@/lib/services/platform-connections";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(appUrl(`/settings/social-publishing?error=${encodeURIComponent(oauthError)}`));
  }
  if (!code || !state) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=missing_code"));
  }
  const verified = await verifyOAuthState("tiktok", state);
  if (!verified) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=state_mismatch"));
  }

  try {
    const tokens = await exchangeTikTokCode(code);
    const ttUser = await fetchTikTokUser(tokens.access_token, tokens.open_id);

    await upsertPlatformConnection({
      tenantSlug: verified.tenantSlug,
      platform: "tiktok",
      platformUserId: tokens.open_id,
      platformHandle: `@${ttUser.username}`,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : undefined,
        scopes: tokens.scope?.split(","),
      },
    });
    return NextResponse.redirect(appUrl("/settings/social-publishing?connected=tiktok"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(appUrl(`/settings/social-publishing?error=${encodeURIComponent(msg)}`));
  }
}
