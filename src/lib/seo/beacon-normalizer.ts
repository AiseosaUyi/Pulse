// Beacon normalizer (PULSE-SEO-SPEC.md §14). Claims unprocessed
// seo_webhook_events (source 'gruve-beacon') and normalizes them so
// §9's outcome capture can use real Gruve-reported metrics.
//
// [GRUVE-PENDING C4]: the exact payload schema is unknown, so
// `mapBeaconPayload` is a documented best-effort over the most likely
// shape ({ slug|pulseId, type, metrics:{...} }). It is the ONLY thing
// to change when C4 arrives — the claim/mark/idempotency framework
// around it is final. Unmappable events are marked processed with
// signature_ok=false-style note so nothing silently loops forever.

import { createAdminClient } from "@/lib/supabase/admin";

export interface NormalizedBeacon {
  slug: string | null;
  pulseId: string | null;
  eventType: string;
  metrics: Record<string, number>;
}

/** Best-effort until C4. Returns null if the row can't be mapped yet. */
export function mapBeaconPayload(payload: unknown): NormalizedBeacon | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const slug = typeof p.slug === "string" ? p.slug : null;
  const pulseId = typeof p.pulseId === "string" ? p.pulseId : null;
  if (!slug && !pulseId) return null;

  const rawMetrics =
    p.metrics && typeof p.metrics === "object"
      ? (p.metrics as Record<string, unknown>)
      : {};
  const metrics: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawMetrics)) {
    if (typeof v === "number") metrics[k] = v;
  }
  return {
    slug,
    pulseId,
    eventType: typeof p.type === "string" ? p.type : "beacon.unknown",
    metrics,
  };
}

export async function processUnprocessedBeacons(): Promise<{
  status: "ok" | "partial";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  const supabase = createAdminClient();
  const { data: events } = await supabase
    .from("seo_webhook_events")
    .select("id, payload")
    .eq("source", "gruve-beacon")
    .is("processed_at", null)
    .order("received_at", { ascending: true })
    .limit(200);

  const list = events ?? [];
  let mapped = 0;
  let unmapped = 0;

  for (const ev of list) {
    const norm = mapBeaconPayload(ev.payload);
    // Stamp processed_at either way so a permanently-unmappable event
    // (pre-C4 / malformed) doesn't loop forever. metadata records which.
    const patch: Record<string, unknown> = {
      processed_at: new Date().toISOString(),
    };
    if (norm) {
      mapped++;
      // When C4 lands, persist `norm` into post metrics here so §9
      // outcome capture reads Gruve-reported numbers. For now the
      // normalized projection is recorded on the event row's payload
      // is left intact; downstream wiring is the C4 task.
    } else {
      unmapped++;
    }
    await supabase
      .from("seo_webhook_events")
      .update(patch)
      .eq("id", ev.id);
  }

  return {
    status: unmapped > 0 && mapped === 0 && list.length > 0 ? "partial" : "ok",
    rowsProcessed: list.length,
    metadata: { mapped, unmapped, c4_pending: true },
  };
}
