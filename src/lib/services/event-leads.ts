// Shared capture logic for event/organizer leads scraped from the
// known "needs a real browser" ticketing platforms (Clooza,
// Tickethub.ng, Eventpadi, EventPorte, Tixvnt). Extracted verbatim
// from `/api/ext/event-lead` (POST) so `/api/v1/event-leads` can share
// it — the ext route now calls this function and its behavior/response
// shape is unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";
import { detectFromUrl } from "@/lib/outbound/handle";
import {
  resolveHandleViaSerp,
  slugifyForHandle,
} from "@/lib/scrape/event-scraper-runner";
import type { ProspectRecord, OutboundPlatform } from "@/lib/types/outbound";

export const KNOWN_EVENT_LEAD_PLATFORM_IDS = new Set([
  "clooza",
  "tickethub",
  "eventpadi",
  "eventporte",
  "tixvnt",
]);

export interface CaptureEventLeadInput {
  platformId: string;
  pageUrl: string;
  eventTitle?: string | null;
  organizerName?: string | null;
  organizerHandle?: string | null;
  priceRaw?: string | null;
  socialUrl?: string | null;
  /** Who's calling — kept explicit so `signal_data.capture_method`
   * stays accurate as more callers (the extension, /api/v1) share
   * this function. */
  captureMethod: string;
}

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
    quality: (row.quality as ProspectRecord["quality"]) ?? "unscored",
    duplicateOfId: (row.duplicate_of_id as string) ?? null,
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

export async function captureEventLead(
  client: SupabaseClient,
  tenantSlug: string,
  input: CaptureEventLeadInput
): Promise<{ prospect: ProspectRecord } | { error: string }> {
  if (!KNOWN_EVENT_LEAD_PLATFORM_IDS.has(input.platformId) || !input.pageUrl) {
    return { error: "platformId (known event platform) and pageUrl required" };
  }

  const eventTitle = input.eventTitle ?? null;
  const organizerName = input.organizerName ?? null;
  const organizerHandle = input.organizerHandle ?? null;
  const priceRaw = input.priceRaw ?? null;
  const socialUrl = input.socialUrl ?? null;

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
    handle = `${input.platformId}-${organizerHandle.toLowerCase()}`;
    profileUrl = input.pageUrl;
  }
  if (!handle) {
    const query = organizerName ?? eventTitle ?? input.pageUrl;
    const resolved = await resolveHandleViaSerp(query);
    if (resolved) {
      platform = resolved.platform;
      handle = resolved.handle;
      profileUrl = resolved.profileUrl;
    }
  }
  if (!handle) {
    handle = `event-${input.platformId}-${slugifyForHandle(eventTitle ?? input.pageUrl)}`;
  }

  const { data, error } = await client
    .from("prospects")
    .upsert(
      {
        tenant_slug: tenantSlug,
        platform,
        handle,
        display_name: organizerName,
        profile_url: profileUrl,
        event_title: eventTitle,
        // Keep this human-readable — source type is carried structurally
        // in signal_data.source_type below, not as a prefix here. This
        // string flows verbatim into the DM-drafting AI prompt and UI.
        signal_summary: `${eventTitle ?? "Captured event"} · ${priceRaw ?? "paid"} · ${input.captureMethod} capture`,
        signal_data: {
          source_type: "event_platform_scraper",
          platform_id: input.platformId,
          capture_method: input.captureMethod,
          event_url: input.pageUrl,
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
    return { error: error?.message ?? "Insert failed" };
  }

  return { prospect: toProspect(data) };
}
