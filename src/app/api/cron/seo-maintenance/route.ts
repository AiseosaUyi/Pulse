// Single daily SEO cron (Hobby plan: daily-only + low cron count).
// Runs all six SEO jobs in one invocation. Bearer-gated; one cron_runs
// row. Scheduled 08:00 UTC so decay detection matches Pack C §10.

import { NextResponse } from "next/server";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { runSeoMaintenance } from "@/lib/seo/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const result = await withCronRun("seo-maintenance", () =>
    runSeoMaintenance()
  );
  return NextResponse.json(result);
}

// Vercel Cron invokes scheduled endpoints with GET; alias the handler so
// the scheduler reaches it (previously 405ed, so these crons never ran).
export const GET = POST;
