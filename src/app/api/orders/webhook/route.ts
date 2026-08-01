// Commerce webhook: the storefront (e.g. sippy.life) POSTs here on checkout
// so an order can be attributed back to a Pulse-published campaign. Auth is a
// tenant API token (same scheme as /api/ext/*). Idempotent on external_id, so
// retries / duplicate fires collapse to one order row + one 'created' event.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import { fireOrderConversionEvents } from "@/lib/attribution/ads-conversions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const CHANNELS = new Set(["web", "whatsapp", "dm", "phone"]);
const STATUSES = new Set([
  "created",
  "paid",
  "fulfilled",
  "refunded",
  "cancelled",
]);

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

  const externalId =
    typeof body.external_id === "string" ? body.external_id : null;
  const channelRaw =
    typeof body.channel === "string" ? body.channel.toLowerCase() : "web";
  const channel = CHANNELS.has(channelRaw) ? channelRaw : "web";
  const statusRaw =
    typeof body.status === "string" ? body.status.toLowerCase() : "created";
  const status = STATUSES.has(statusRaw) ? statusRaw : "created";
  const amount =
    typeof body.amount === "number" && Number.isFinite(body.amount)
      ? body.amount
      : null;

  const admin = createAdminClient();

  const orderPayload = {
    tenant_slug: auth.tenantSlug,
    external_id: externalId,
    source: typeof body.source === "string" ? body.source : null,
    channel,
    utm_campaign:
      typeof body.utm_campaign === "string" ? body.utm_campaign : null,
    utm_content: typeof body.utm_content === "string" ? body.utm_content : null,
    amount,
    currency: typeof body.currency === "string" ? body.currency : "NGN",
    status,
  };

  // Idempotent when an external_id is present; otherwise always a new row.
  const query = externalId
    ? admin
        .from("orders")
        .upsert(orderPayload, { onConflict: "tenant_slug,external_id" })
    : admin.from("orders").insert(orderPayload);

  const { data: order, error } = await query.select("id").single();
  if (error || !order) {
    return NextResponse.json(
      { error: error?.message ?? "Order write failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  await admin.from("order_events").insert({
    order_id: order.id,
    tenant_slug: auth.tenantSlug,
    event: status,
    meta: { raw: body },
  });

  // Best-effort server-side conversion push (Meta CAPI / TikTok Events API)
  // to every connected ad account with pixel config. Awaited (not
  // fire-and-forget) so it actually completes before the function returns
  // — a serverless function isn't guaranteed to keep running after its
  // response is sent. Internally never throws (see
  // fireOrderConversionEvents), so this can't fail the webhook response.
  // Only fires on a real purchase-completion status, not on a bare
  // "created" (cart-abandon-prone) event.
  if (status === "paid" || status === "fulfilled") {
    const customer = (body.customer as Record<string, unknown> | undefined) ?? undefined;
    await fireOrderConversionEvents({
      tenantSlug: auth.tenantSlug,
      orderId: order.id,
      amount,
      currency: orderPayload.currency,
      eventTime: Math.floor(Date.now() / 1000),
      customer: customer
        ? {
            email: typeof customer.email === "string" ? customer.email : undefined,
            phone: typeof customer.phone === "string" ? customer.phone : undefined,
            ip: typeof customer.ip === "string" ? customer.ip : undefined,
            userAgent: typeof customer.user_agent === "string" ? customer.user_agent : undefined,
            fbc: typeof customer.fbc === "string" ? customer.fbc : undefined,
            fbp: typeof customer.fbp === "string" ? customer.fbp : undefined,
            ttclid: typeof customer.ttclid === "string" ? customer.ttclid : undefined,
          }
        : undefined,
    });
  }

  return NextResponse.json(
    { ok: true, orderId: order.id },
    { status: 200, headers: CORS_HEADERS }
  );
}
