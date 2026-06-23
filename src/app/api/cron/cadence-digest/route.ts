import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { sendCadenceDigest } from "@/lib/cadence/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// End-of-day cadence nudge. Schedule at the founder's evening (UTC) in
// vercel.json — Hobby crons are daily-only, so this is an end-of-day digest,
// not an intraday escalation (that's the deferred B5/Web Push).
export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("cadence-digest", async () => {
    const admin = createAdminClient();
    const summary = {
      tenantsProcessed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      errors: [] as { tenant: string; message: string }[],
    };

    const { data: tenants, error } = await admin.from("tenants").select("slug");
    if (error || !tenants) {
      throw new Error(error?.message ?? "Failed to list tenants");
    }

    for (const tenant of tenants as Array<{ slug: string }>) {
      summary.tenantsProcessed += 1;
      try {
        const outcome = await sendCadenceDigest(tenant.slug);
        if (outcome.status === "sent") summary.sent += 1;
        else if (outcome.status === "skipped") summary.skipped += 1;
        else {
          summary.failed += 1;
          summary.errors.push({ tenant: tenant.slug, message: outcome.reason });
        }
      } catch (err) {
        summary.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ tenant: tenant.slug, message });
        console.error(`[cron/cadence-digest] ${tenant.slug} threw`, message);
      }
    }

    const status =
      summary.failed === 0 ? "ok" : summary.sent > 0 ? "partial" : "failed";
    return { status, rowsProcessed: summary.sent, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}
