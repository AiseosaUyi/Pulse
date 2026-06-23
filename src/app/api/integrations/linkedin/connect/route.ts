import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { generateOAuthState, appUrl } from "@/lib/integrations/platform-oauth";
import { buildLinkedInAuthUrl, isLinkedInConfigured } from "@/lib/integrations/platforms/linkedin";

export async function GET(): Promise<Response> {
  if (!isLinkedInConfigured()) {
    return NextResponse.redirect(appUrl("/settings/social-publishing?error=linkedin_not_configured"));
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));
  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const state = await generateOAuthState("linkedin", tenant.slug, user.id);
  return NextResponse.redirect(buildLinkedInAuthUrl(state));
}
