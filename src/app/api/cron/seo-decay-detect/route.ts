// Daily content-decay detection (PULSE-SEO-SPEC.md Pack C §10).
// Cron: 08:00 UTC per the rubric. Bearer-gated; one cron_runs row.

import { NextResponse } from "next/server";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { detectDecay } from "@/lib/seo/detect-decay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const result = await withCronRun("seo-decay-detect", () => detectDecay());
  return NextResponse.json(result);
}

// Vercel Cron invokes scheduled endpoints with GET; alias the handler so
// the scheduler reaches it (previously 405ed, so these crons never ran).
export const GET = POST;
