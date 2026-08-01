// Fires server-side conversion events (Meta CAPI, TikTok Events API) for a
// real order, to every ad account on the tenant that has pixel config set
// up. Best-effort by design — a CAPI/Events API failure must never affect
// order recording, which has already succeeded by the time this runs.
//
// Deliberately does NOT persist any customer PII passed in `customer` —
// it's hashed (email/phone) or passed through raw (ip/user-agent/click-ids,
// which aren't PII on their own) directly into the platform push and
// discarded after. `order_events.meta` already stores the raw webhook body
// verbatim (pre-existing behavior, unrelated to this addition) — this
// function doesn't add any new persistence.

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/integrations/platform-crypto";
import { pushMetaConversionEvent } from "@/lib/integrations/meta-capi";
import { pushTikTokEvent } from "@/lib/integrations/tiktok-ads";

export interface OrderConversionEvent {
  tenantSlug: string;
  orderId: string;
  amount: number | null;
  currency: string;
  eventTime: number; // unix seconds
  customer?: {
    email?: string;
    phone?: string;
    ip?: string;
    userAgent?: string;
    fbc?: string;
    fbp?: string;
    ttclid?: string;
  };
}

/** Best-effort — every platform push is independently caught so one
 *  platform's failure (or simply not having CAPI configured) never affects
 *  another, and never throws back to the caller. */
export async function fireOrderConversionEvents(input: OrderConversionEvent): Promise<void> {
  const admin = createAdminClient();
  const { data: accounts } = await admin
    .from("ad_accounts")
    .select("id, platform, connected_account_id, tiktok_connection_id, meta_pixel_id, meta_capi_token_enc, tiktok_pixel_code")
    .eq("tenant_slug", input.tenantSlug)
    .eq("status", "active");

  if (!accounts || accounts.length === 0) return;

  await Promise.allSettled(
    accounts.map(async (acc) => {
      try {
        if (acc.platform === "meta" && acc.meta_pixel_id && acc.meta_capi_token_enc) {
          await pushMetaConversionEvent(acc.meta_pixel_id, decryptToken(acc.meta_capi_token_enc), {
            eventName: "Purchase",
            eventId: input.orderId,
            eventTime: input.eventTime,
            email: input.customer?.email,
            phone: input.customer?.phone,
            clientIpAddress: input.customer?.ip,
            clientUserAgent: input.customer?.userAgent,
            fbc: input.customer?.fbc,
            fbp: input.customer?.fbp,
            value: input.amount ?? undefined,
            currency: input.currency,
          });
        } else if (acc.platform === "tiktok" && acc.tiktok_pixel_code && acc.tiktok_connection_id) {
          const { data: connRow } = await admin
            .from("tiktok_ads_connections")
            .select("access_token_enc, status")
            .eq("id", acc.tiktok_connection_id)
            .maybeSingle();
          if (!connRow || connRow.status !== "active") return;
          await pushTikTokEvent(decryptToken(connRow.access_token_enc), {
            pixelCode: acc.tiktok_pixel_code,
            event: "CompletePayment",
            eventId: input.orderId,
            eventTime: input.eventTime,
            email: input.customer?.email,
            phone: input.customer?.phone,
            ip: input.customer?.ip,
            userAgent: input.customer?.userAgent,
            ttclid: input.customer?.ttclid,
            value: input.amount ?? undefined,
            currency: input.currency,
          });
        }
      } catch (err) {
        console.error(
          `[ads-conversions] failed to push order ${input.orderId} to ${acc.platform} ad account ${acc.id}`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );
}
