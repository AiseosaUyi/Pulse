import { NextResponse } from "next/server";
import { verifyOAuthState, appUrl } from "@/lib/integrations/platform-oauth";
import { exchangeLinkedInCode, fetchLinkedInUser } from "@/lib/integrations/platforms/linkedin";
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
  const verified = await verifyOAuthState("linkedin", state);
  if (!verified) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=state_mismatch"));
  }

  try {
    const tokens = await exchangeLinkedInCode(code);
    const liUser = await fetchLinkedInUser(tokens.access_token);

    await upsertPlatformConnection({
      tenantSlug: verified.tenantSlug,
      platform: "linkedin",
      platformUserId: liUser.id,
      platformHandle: liUser.name,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        // LinkedIn access tokens last 60 days
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    return NextResponse.redirect(appUrl("/settings/social-publishing?connected=linkedin"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(appUrl(`/settings/social-publishing?error=${encodeURIComponent(msg)}`));
  }
}
