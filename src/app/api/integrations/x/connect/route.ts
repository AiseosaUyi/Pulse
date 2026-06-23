import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import {
  generateOAuthState,
  storeXPkceVerifier,
  appUrl,
} from "@/lib/integrations/platform-oauth";
import { buildXAuthUrl, generateXPkce, isXConfigured } from "@/lib/integrations/platforms/x";

export async function GET(): Promise<Response> {
  if (!isXConfigured()) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=x_not_configured"));
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));
  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const state = await generateOAuthState("x", tenant.slug, user.id);
  const { verifier, challenge } = generateXPkce();
  await storeXPkceVerifier(verifier);

  return NextResponse.redirect(buildXAuthUrl(state, challenge));
}
