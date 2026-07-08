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
import { detectFromUrl } from "@/lib/outbound/handle";
import {
  resolveHandleViaSerp,
  slugifyForHandle,
} from "@/lib/scrape/event-scraper-runner";
import type { ProspectRecord, OutboundPlatform } from "@/lib/types/outbound";

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const KNOWN_PLATFORM_IDS = new Set([
  "clooza",
  "tickethub",
  "eventpadi",
  "eventporte",
  "tixvnt",
]);

function toProspect(row: Record<string, unknown>): ProspectRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    searchId: (row.search_id as string) ?? null,
    platform: row.platform as OutboundPlatform,
    handle: row.handle as string,
    displayName: (row.display_name as string) ?? null,
    profileUrl: (row.profile_url as string) ?? null,
    avatarUrl: (row.avatar_url as string) ?? null,
    bio: (row.bio as string) ?? null,
    followerCount: (row.follower_count as number) ?? null,
    signalSummary: (row.signal_summary as string) ?? null,
    signalData: (row.signal_data as Record<string, unknown>) ?? {},
    qualificationScore: (row.qualification_score as number) ?? null,
    qualificationReason: (row.qualification_reason as string) ?? null,
    status: row.status as ProspectRecord["status"],
    notes: (row.notes as string) ?? null,
    category: (row.category as string) ?? null,
    location: (row.location as string) ?? null,
    verifiedName: (row.verified_name as string) ?? null,
    eventTitle: (row.event_title as string) ?? null,
    phone: (row.phone as string) ?? null,
    lastReachoutAt: (row.last_reachout_at as string) ?? null,
    lastTouchedAt: (row.last_touched_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

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

  const eventTitle = (body.eventTitle as string | null) ?? null;
  const organizerName = (body.organizerName as string | null) ?? null;
  const organizerHandle = (body.organizerHandle as string | null) ?? null;
  const priceRaw = (body.priceRaw as string | null) ?? null;
  const socialUrl = (body.socialUrl as string | null) ?? null;

  // Resolution order: (1) a real social link found on the page, (2) a
  // platform-native handle in the URL itself (Clooza's clooza.com/<handle>),
  // (3) SERP fallback by organizer name or event title — same as the cron.
  let platform: OutboundPlatform = "manual";
  let handle: string | null = null;
  let profileUrl: string | null = null;

  if (socialUrl) {
    const detected = detectFromUrl(socialUrl);
    if (detected) {
      platform = detected.platform;
      handle = detected.handle;
      profileUrl = detected.profileUrl;
    }
  }
  if (!handle && organizerHandle) {
    handle = `${platformId}-${organizerHandle.toLowerCase()}`;
    profileUrl = pageUrl;
  }
  if (!handle) {
    const query = organizerName ?? eventTitle ?? pageUrl;
    const resolved = await resolveHandleViaSerp(query);
    if (resolved) {
      platform = resolved.platform;
      handle = resolved.handle;
      profileUrl = resolved.profileUrl;
    }
  }
  if (!handle) {
    handle = `event-${platformId}-${slugifyForHandle(eventTitle ?? pageUrl)}`;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("prospects")
    .upsert(
      {
        tenant_slug: auth.tenantSlug,
        platform,
        handle,
        display_name: organizerName,
        profile_url: profileUrl,
        event_title: eventTitle,
        signal_summary: `[event_platform_scraper] ${eventTitle ?? "Captured event"} · ${priceRaw ?? "paid"} · extension capture`,
        signal_data: {
          source_type: "event_platform_scraper",
          platform_id: platformId,
          capture_method: "extension",
          event_url: pageUrl,
          price_raw: priceRaw,
          organizer_name: organizerName,
          social_url: socialUrl,
          resolved_via: platform !== "manual" ? "resolved" : "unresolved",
          qualify_pending: true,
        },
        status: "new",
      },
      { onConflict: "tenant_slug,platform,handle" }
    )
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Insert failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { prospect: toProspect(data) },
    { status: 200, headers: CORS_HEADERS }
  );
}
