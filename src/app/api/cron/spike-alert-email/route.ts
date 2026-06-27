// Runs hourly — scans for intel cards with vsAverage >= 3 detected in the
// last 2 hours and emails the tenant's owner(s) with a brand-voice "your angle".
// Uses a 2-hour window so the cron can safely overlap without double-sending.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { sendSpikeAlert } from "@/lib/email/send-spike-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SPIKE_THRESHOLD = 3; // vsAverage >= 3 to qualify as a spike

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  // Find newly detected high-engagement cards
  const { data: cards, error } = await admin
    .from("intel_cards")
    .select(
      "tenant_id, competitor_name, platform, content_type, summary, metrics"
    )
    .gte("detected_at", twoHoursAgo)
    .gt("metrics->vsAverage" as string, SPIKE_THRESHOLD - 1); // cast for TS

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const alerted: string[] = [];
  const errors: string[] = [];

  for (const card of cards ?? []) {
    const metrics = card.metrics as { vsAverage?: number } | null;
    const vsAverage = metrics?.vsAverage ?? 0;
    if (vsAverage < SPIKE_THRESHOLD) continue;

    try {
      await sendSpikeAlert({
        tenantSlug: card.tenant_id as string,
        competitorName: card.competitor_name as string,
        platform: card.platform as string,
        contentType: card.content_type as string,
        multiplier: vsAverage,
        summary: (card.summary as string).slice(0, 300),
      });
      alerted.push(`${card.tenant_id}/${card.competitor_name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${card.tenant_id}: ${msg}`);
    }
  }

  return NextResponse.json({ alerted: alerted.length, details: alerted, errors });
}
