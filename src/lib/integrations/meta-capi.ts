// Meta Conversions API — server-side conversion events, sent directly from
// Pulse's backend rather than relying on the client-side Pixel alone.
// Matters because post-iOS-ATT and with ad blockers/ITP, the Pixel alone
// under-reports real conversions — CAPI recovers events the browser never
// saw, feeding both attribution accuracy (src/lib/attribution/ads.ts) and
// the ad platform's own optimization signal.
//
// Deduplication: send the SAME event_id from both the client Pixel (if the
// storefront also fires one) and this server call for the same real-world
// purchase — Meta collapses them into one on ingestion. The orders webhook
// uses the order's own external_id as event_id, which is naturally stable
// and unique per order.

import { createHash } from "node:crypto";

const GRAPH_VERSION = "v25.0";

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export interface MetaCapiEvent {
  eventName: string; // 'Purchase', 'Lead', etc.
  eventId: string; // dedup key, shared with any client-side pixel fire
  eventTime: number; // unix seconds
  eventSourceUrl?: string;
  email?: string; // raw — hashed internally, never logged
  phone?: string; // raw — hashed internally, never logged
  externalId?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbc?: string;
  fbp?: string;
  value?: number;
  currency?: string;
  contentIds?: string[];
}

export class MetaCapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaCapiError";
  }
}

export async function pushMetaConversionEvent(
  pixelId: string,
  accessToken: string,
  event: MetaCapiEvent,
  testEventCode?: string
): Promise<void> {
  const userData: Record<string, unknown> = {};
  if (event.email) userData.em = sha256(event.email);
  if (event.phone) userData.ph = sha256(event.phone.replace(/[^0-9]/g, ""));
  if (event.externalId) userData.external_id = event.externalId;
  if (event.clientIpAddress) userData.client_ip_address = event.clientIpAddress;
  if (event.clientUserAgent) userData.client_user_agent = event.clientUserAgent;
  if (event.fbc) userData.fbc = event.fbc;
  if (event.fbp) userData.fbp = event.fbp;

  const payload = {
    data: [
      {
        event_name: event.eventName,
        event_time: event.eventTime,
        event_id: event.eventId,
        event_source_url: event.eventSourceUrl,
        action_source: "website",
        user_data: userData,
        custom_data: {
          value: event.value,
          currency: event.currency,
          content_ids: event.contentIds,
        },
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new MetaCapiError(`Meta CAPI push failed (HTTP ${res.status}): ${body}`);
  }
}

/** Subscribes an ad account to Meta's webhook push (creative_fatigue,
 *  with_issues_ad_objects, ad_recommendations — see
 *  /api/webhooks/meta-ads). Needs a raw access token with edit permission
 *  on the ad account and ads_management scope; Composio manages Meta's
 *  OAuth token opaquely (no raw-token extraction), so this reuses the
 *  same manually-entered System User token stored for CAPI rather than
 *  requiring yet another credential — a reasonable reuse since a System
 *  User token capable of pushing conversion events already has
 *  ads_management-level access. One-time action per ad account, triggered
 *  from Settings once both a Meta connection and a CAPI token exist. */
export async function subscribeMetaAdAccountWebhook(adAccountExternalId: string, accessToken: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${adAccountExternalId}/subscribed_apps`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: accessToken }),
  });
  if (!res.ok) {
    throw new MetaCapiError(`Meta webhook subscription failed (HTTP ${res.status}): ${await res.text()}`);
  }
}
