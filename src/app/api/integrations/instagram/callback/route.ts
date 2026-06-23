import { NextResponse } from "next/server";
import { verifyOAuthState, appUrl } from "@/lib/integrations/platform-oauth";
import { exchangeInstagramCode, fetchInstagramUser } from "@/lib/integrations/platforms/instagram";
import { upsertPlatformConnection } from "@/lib/services/platform-connections";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.replace("#_", "") ?? null;
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(appUrl(`/settings/social-publishing?error=${encodeURIComponent(oauthError)}`));
  }
  if (!code || !state) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=missing_code"));
  }
  const verified = await verifyOAuthState("instagram", state);
  if (!verified) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=state_mismatch"));
  }

  try {
    const tokens = await exchangeInstagramCode(code);
    const igUser = await fetchInstagramUser(tokens.access_token);

    await upsertPlatformConnection({
      tenantSlug: verified.tenantSlug,
      platform: "instagram",
      platformUserId: igUser.igUserId,
      platformHandle: `@${igUser.username}`,
      tokens: {
        accessToken: tokens.access_token,
        // Instagram long-lived tokens last 60 days; no refresh token
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    return NextResponse.redirect(appUrl("/settings/social-publishing?connected=instagram"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(appUrl(`/settings/social-publishing?error=${encodeURIComponent(msg)}`));
  }
}
