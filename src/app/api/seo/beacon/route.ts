// Pulse-side beacon receiver (PULSE-SEO-SPEC.md §14). Gruve's backend
// forwards post-publish performance events here. SKELETON: verify the
// bearer, persist the raw event to seo_webhook_events, return 202.
// Payload normalization → post metrics is [GRUVE-PENDING] (wire
// contract C4); it lands when the schema is supplied. Keeping raw means
// no data is lost in the meantime.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function bearerOk(req: Request): boolean {
  const secret = process.env.PULSE_BEACON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.PULSE_BEACON_SECRET) {
    return NextResponse.json(
      { error: "beacon not configured" },
      { status: 503 }
    );
  }
  if (!bearerOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    const raw = await req.text().catch(() => "");
    payload = { _unparsed: raw };
  }

  // C4 envelope: { receivedAt, ipTrunc, country, ua, events:[{name,
  // occurredAt, sessionId, slug?, payload}] }. No tenant or pulseId at
  // beacon time — events join to posts by `slug`, resolved (with tenant)
  // by the normalizer. Store the whole envelope verbatim.
  const p = (payload ?? {}) as Record<string, unknown>;
  const events = Array.isArray(p.events) ? p.events : [];
  const eventType =
    events.length > 0 ? "beacon.batch" : "beacon.empty";

  const supabase = createAdminClient();
  const { error } = await supabase.from("seo_webhook_events").insert({
    tenant_slug: null, // resolved per-event by slug in the normalizer
    source: "gruve-beacon",
    event_type: eventType,
    payload: p,
    signature_ok: true,
    // processed_at left null — the normalizer claims it.
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // 202: accepted, not yet processed.
  return NextResponse.json({ accepted: true }, { status: 202 });
}
