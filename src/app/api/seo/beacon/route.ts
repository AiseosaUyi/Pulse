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

  const p = (payload ?? {}) as Record<string, unknown>;
  const tenantSlug =
    typeof p.tenantSlug === "string" ? p.tenantSlug : null;
  const eventType =
    typeof p.type === "string" ? p.type : "beacon.unknown";

  const supabase = createAdminClient();
  const { error } = await supabase.from("seo_webhook_events").insert({
    tenant_slug: tenantSlug,
    source: "gruve-beacon",
    event_type: eventType,
    payload: p,
    signature_ok: true,
    // processed_at left null — the C4 normalizer claims it later.
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // 202: accepted, not yet processed.
  return NextResponse.json({ accepted: true }, { status: 202 });
}
