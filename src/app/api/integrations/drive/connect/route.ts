// Drive OAuth initiator. Builds the consent URL, sets a short-lived
// signed state cookie, redirects the user to Google. The callback
// verifies the cookie matches the returned state.
//
// Owner/admin only — enforced by checking tenant role server-side.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { buildAuthUrl, isDriveConfigured } from "@/lib/integrations/drive";

const STATE_COOKIE = "pulse_drive_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

export async function GET(): Promise<Response> {
  if (!isDriveConfigured()) {
    return NextResponse.json(
      { error: "Drive integration not configured. Contact your admin." },
      { status: 503 }
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
    );
  }
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "No tenant" }, { status: 400 });
  }
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return NextResponse.json(
      { error: "Owner/admin only" },
      { status: 403 }
    );
  }

  // State payload: nonce|tenantSlug|userId. We sign by storing the
  // exact payload in an httpOnly cookie and comparing equality on
  // callback — the cookie itself is the secret.
  const nonce = randomBytes(24).toString("base64url");
  const payload = `${nonce}.${tenant.slug}.${user.id}`;

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, payload, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_TTL_SECONDS,
    path: "/",
  });

  const url = buildAuthUrl(payload);
  return NextResponse.redirect(url);
}
