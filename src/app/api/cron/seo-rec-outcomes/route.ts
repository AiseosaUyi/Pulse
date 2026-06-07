// Daily 30-day recommendation outcome capture (PULSE-SEO-SPEC.md §9,
// M4). Bearer-gated; one cron_runs row per invocation.

import { NextResponse } from "next/server";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { captureDueOutcomes } from "@/lib/seo/rec-outcomes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const result = await withCronRun("seo-rec-outcomes", () =>
    captureDueOutcomes()
  );
  return NextResponse.json(result);
}
