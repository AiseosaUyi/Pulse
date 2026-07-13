// RFC 8414 Authorization Server Metadata. mcp-handler doesn't provide this
// (it only ships RFC 9728 protected-resource metadata helpers) — hand-
// rolled here, served at /.well-known/oauth-authorization-server via the
// vercel.json + next.config.ts rewrite (this repo's existing convention
// for /.well-known/jwks.json — a route can't literally live at a
// dot-prefixed app-router path).

import { NextResponse } from "next/server";
import { appUrl } from "@/lib/integrations/platform-oauth";
import { API_V1_SCOPES } from "@/lib/api/scopes";

export const dynamic = "force-dynamic";

export async function GET() {
  const issuer = appUrl("/").replace(/\/$/, "");
  return NextResponse.json(
    {
      issuer,
      authorization_endpoint: appUrl("/oauth/authorize"),
      token_endpoint: appUrl("/api/oauth/token"),
      registration_endpoint: appUrl("/api/oauth/register"),
      scopes_supported: [...API_V1_SCOPES],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    },
    { headers: { "cache-control": "public, max-age=3600" } }
  );
}
