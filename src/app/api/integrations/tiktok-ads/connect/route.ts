import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { generateOAuthState, appUrl } from "@/lib/integrations/platform-oauth";
import { buildTikTokAdsAuthUrl, isTikTokAdsConfigured } from "@/lib/integrations/tiktok-ads";

export async function GET(): Promise<Response> {
  if (!isTikTokAdsConfigured()) {
    return NextResponse.redirect(appUrl("/settings/integrations?error=tiktok_ads_not_configured"));
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));
  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return NextResponse.redirect(appUrl("/settings/integrations?error=owner_admin_only"));
  }

  const state = await generateOAuthState("tiktok_ads", tenant.slug, user.id);
  return NextResponse.redirect(buildTikTokAdsAuthUrl(state));
}
