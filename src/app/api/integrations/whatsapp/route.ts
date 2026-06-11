// WhatsApp Cloud API webhook.
//   GET  — Meta's subscription verification handshake.
//   POST — inbound messages → inbound_messages (channel='whatsapp').
// Public (Meta calls it); /api/* is exempt from the auth proxy. Verification
// token + inbound mapping come from env (see lib/integrations/whatsapp.ts).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseInboundWebhook,
  getWhatsappAccountByPhoneId,
} from "@/lib/integrations/whatsapp";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (
    mode === "subscribe" &&
    token &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = parseInboundWebhook(payload);
  if (messages.length === 0) {
    return NextResponse.json({ ok: true, ingested: 0 });
  }

  const admin = createAdminClient();
  // Resolve each receiving number to its tenant once, then ingest.
  const tenantByPhone = new Map<string, string | null>();
  let ingested = 0;
  let unmatched = 0;

  for (const m of messages) {
    if (!tenantByPhone.has(m.phoneNumberId)) {
      const account = await getWhatsappAccountByPhoneId(m.phoneNumberId);
      tenantByPhone.set(m.phoneNumberId, account?.tenantSlug ?? null);
    }
    const tenantSlug = tenantByPhone.get(m.phoneNumberId);
    if (!tenantSlug) {
      unmatched += 1; // a number not connected to any tenant — ignore
      continue;
    }
    const receivedAt = m.timestamp
      ? new Date(Number(m.timestamp) * 1000).toISOString()
      : new Date().toISOString();
    const { error } = await admin.from("inbound_messages").upsert(
      {
        tenant_slug: tenantSlug,
        platform: "whatsapp",
        channel: "whatsapp",
        external_id: m.id,
        body: m.text,
        received_at: receivedAt,
      },
      { onConflict: "tenant_slug,platform,external_id" }
    );
    if (!error) ingested += 1;
  }

  return NextResponse.json({ ok: true, ingested, unmatched });
}
