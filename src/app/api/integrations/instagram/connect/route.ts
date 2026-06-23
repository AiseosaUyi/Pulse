import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { generateOAuthState, appUrl } from "@/lib/integrations/platform-oauth";
import { buildInstagramAuthUrl, isInstagramConfigured } from "@/lib/integrations/platforms/instagram";

export async function GET(): Promise<Response> {
  if (!isInstagramConfigured()) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=instagram_not_configured"));
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));
  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const state = await generateOAuthState("instagram", tenant.slug, user.id);
  return NextResponse.redirect(buildInstagramAuthUrl(state));
}
