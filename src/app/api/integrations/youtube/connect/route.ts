import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { generateOAuthState, appUrl } from "@/lib/integrations/platform-oauth";
import { buildYouTubeAuthUrl, isYouTubeConfigured } from "@/lib/integrations/platforms/youtube";

export async function GET(): Promise<Response> {
  if (!isYouTubeConfigured()) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=youtube_not_configured"));
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));
  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const state = await generateOAuthState("youtube", tenant.slug, user.id);
  return NextResponse.redirect(buildYouTubeAuthUrl(state));
}
