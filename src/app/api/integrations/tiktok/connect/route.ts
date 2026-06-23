import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { generateOAuthState, appUrl } from "@/lib/integrations/platform-oauth";
import { buildTikTokAuthUrl, isTikTokConfigured } from "@/lib/integrations/platforms/tiktok";

export async function GET(): Promise<Response> {
  if (!isTikTokConfigured()) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=tiktok_not_configured"));
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));
  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const state = await generateOAuthState("tiktok", tenant.slug, user.id);
  return NextResponse.redirect(buildTikTokAuthUrl(state));
}
