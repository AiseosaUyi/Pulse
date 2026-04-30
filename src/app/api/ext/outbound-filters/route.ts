// Extension endpoint: return the tenant's outbound filters
// (keywords + geo scope + competitor URLs + passive toggle + dwell).
// The extension fetches this periodically and caches in chrome.storage
// so local pre-scoring at capture time doesn't hit the network.

import { NextResponse } from "next/server";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import { getOutboundFilters } from "@/lib/server/outbound-filters";

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const auth = await resolveApiToken(extractBearer(req) ?? "");
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const filters = await getOutboundFilters(auth.tenantSlug);
  return NextResponse.json(
    { filters, fetchedAt: new Date().toISOString() },
    { status: 200, headers: CORS_HEADERS }
  );
}
