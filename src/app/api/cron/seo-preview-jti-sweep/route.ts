// Deletes expired preview-token jti ledger rows (PULSE-SEO-SPEC.md
// §13/§16). Bearer-gated; one cron_runs row per invocation.

import { NextResponse } from "next/server";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { sweepPreviewJti } from "@/lib/seo/preview-token";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("seo-preview-jti-sweep", async () => {
    const deleted = await sweepPreviewJti();
    return { status: "ok", rowsProcessed: deleted };
  });

  return NextResponse.json(result);
}

// Vercel Cron invokes scheduled endpoints with GET; alias the handler so
// the scheduler reaches it (previously 405ed, so these crons never ran).
export const GET = POST;
