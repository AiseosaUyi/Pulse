// Normalizes unprocessed Gruve beacons (PULSE-SEO-SPEC.md §14).
// Bearer-gated; one cron_runs row per invocation.

import { NextResponse } from "next/server";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { processUnprocessedBeacons } from "@/lib/seo/beacon-normalizer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const result = await withCronRun("seo-beacon-process", () =>
    processUnprocessedBeacons()
  );
  return NextResponse.json(result);
}
