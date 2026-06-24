// Publishes due scheduled posts. No longer cron-scheduled (folded into
// seo-maintenance for Hobby's daily/low-count cron limits) — kept as a
// bearer-gated manual/on-demand trigger. One cron_runs row.

import { NextResponse } from "next/server";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { sweepDuePublishes } from "@/lib/seo/publish-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const result = await withCronRun("seo-publish-sweep", () =>
    sweepDuePublishes()
  );
  return NextResponse.json(result);
}

// Vercel Cron invokes scheduled endpoints with GET; alias the handler so
// the scheduler reaches it (previously 405ed, so these crons never ran).
export const GET = POST;
