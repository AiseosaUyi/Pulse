// Extension endpoint: capture an event/organizer lead from one of the
// platforms confirmed (2026-07-08) to have real data but need a real
// browser to see it — Clooza, Tickethub.ng, Eventpadi, EventPorte, Tixvnt.
// Separate from /api/ext/prospect on purpose: that endpoint's shape is
// tuned for social-profile capture (IG/TikTok/X/LinkedIn) and is already
// live in daily use — this one carries event-specific fields and has its
// own resolution logic, without touching the existing one.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import { captureEventLead, KNOWN_EVENT_LEAD_PLATFORM_IDS } from "@/lib/services/event-leads";

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const KNOWN_PLATFORM_IDS = KNOWN_EVENT_LEAD_PLATFORM_IDS;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const auth = await resolveApiToken(extractBearer(req) ?? "");
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const platformId = String(body.platformId ?? "");
  const pageUrl = String(body.pageUrl ?? "");
  if (!KNOWN_PLATFORM_IDS.has(platformId) || !pageUrl) {
    return NextResponse.json(
      { error: "platformId (known event platform) and pageUrl required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const admin = createAdminClient();
  const result = await captureEventLead(admin, auth.tenantSlug, {
    platformId,
    pageUrl,
    eventTitle: (body.eventTitle as string | null) ?? null,
    organizerName: (body.organizerName as string | null) ?? null,
    organizerHandle: (body.organizerHandle as string | null) ?? null,
    priceRaw: (body.priceRaw as string | null) ?? null,
    socialUrl: (body.socialUrl as string | null) ?? null,
    captureMethod: "extension",
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { prospect: result.prospect },
    { status: 200, headers: CORS_HEADERS }
  );
}
