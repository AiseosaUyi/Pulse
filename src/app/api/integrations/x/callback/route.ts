import { NextResponse } from "next/server";
import { verifyOAuthState, popXPkceVerifier, appUrl } from "@/lib/integrations/platform-oauth";
import { exchangeXCode, fetchXUser } from "@/lib/integrations/platforms/x";
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

  const verified = await verifyOAuthState("x", state);
  if (!verified) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=state_mismatch"));
  }

  const codeVerifier = await popXPkceVerifier();
  if (!codeVerifier) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=missing_verifier"));
  }

  try {
    const tokens = await exchangeXCode(code, codeVerifier);
    const xUser = await fetchXUser(tokens.access_token);

    await upsertPlatformConnection({
      tenantSlug: verified.tenantSlug,
      platform: "x",
      platformUserId: xUser.id,
      platformHandle: `@${xUser.username}`,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : undefined,
        scopes: tokens.scope?.split(" "),
      },
    });
    return NextResponse.redirect(appUrl("/settings/social-publishing?connected=x"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(appUrl(`/settings/social-publishing?error=${encodeURIComponent(msg)}`));
  }
}
