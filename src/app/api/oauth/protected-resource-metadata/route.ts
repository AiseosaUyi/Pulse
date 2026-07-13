// RFC 9728 Protected Resource Metadata — built from mcp-handler's own
// protectedResourceHandler, the one place the library actually offers
// something for OAuth (it does not provide RFC 8414 or RFC 7591). Served
// at /.well-known/oauth-protected-resource via the vercel.json +
// next.config.ts rewrite.

import { protectedResourceHandler } from "mcp-handler";
import { appUrl } from "@/lib/integrations/platform-oauth";

export const dynamic = "force-dynamic";

export const GET = protectedResourceHandler({
  authServerUrls: [appUrl("/").replace(/\/$/, "")],
  resourceUrl: appUrl("/api/mcp"),
});
