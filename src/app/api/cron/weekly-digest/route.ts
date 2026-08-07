import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { generateWeeklyDigest } from "@/lib/actions/weekly-digest";
import { generateWeeklyReview } from "@/lib/actions/weekly-reviews";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("weekly-digest", async () => {
  const admin = createAdminClient();
  const summary = {
    tenantsProcessed: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    errors: [] as { tenant: string; message: string }[],
  };

  const { data: tenants, error: tenantsErr } = await admin
    .from("tenants")
    .select("slug");
  if (tenantsErr || !tenants) {
    throw new Error(tenantsErr?.message ?? "Failed to list tenants");
  }

  for (const tenant of tenants as Array<{ slug: string }>) {
    summary.tenantsProcessed += 1;
    try {
      const res = await generateWeeklyDigest(tenant.slug, { force: false });
      if (!res.success) {
        summary.failed += 1;
        summary.errors.push({ tenant: tenant.slug, message: res.error });
        console.error(`[cron/weekly-digest] ${tenant.slug} failed`, res.error);
      } else {
        summary.generated += 1;
      }
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ tenant: tenant.slug, message });
      console.error(`[cron/weekly-digest] ${tenant.slug} threw`, message);
    }

    // Also refresh the narrative "weekly business review" (Dashboard
    // widget + weekly-email cron both read weekly_digests.narrative).
    // Nothing previously called generateWeeklyReview() automatically —
    // it only ran when a user manually clicked "Generate this week" on
    // the dashboard — so the narrative went stale indefinitely once
    // that stopped happening, and weekly-email's `.not("narrative", "is",
    // null)` gate meant no emails ever went out either. This cron's own
    // "1hr before weekly-email" comment already assumed this happened.
    try {
      const reviewRes = await generateWeeklyReview(tenant.slug);
      if (!reviewRes.success) {
        summary.errors.push({
          tenant: tenant.slug,
          message: `weekly-review: ${reviewRes.error}`,
        });
        console.error(
          `[cron/weekly-digest] ${tenant.slug} review generation failed`,
          reviewRes.error
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ tenant: tenant.slug, message: `weekly-review: ${message}` });
      console.error(`[cron/weekly-digest] ${tenant.slug} review generation threw`, message);
    }
  }

  console.log("[cron/weekly-digest] complete", summary);
    const status =
      summary.failed === 0 ? "ok" : summary.generated > 0 ? "partial" : "failed";
    return { status, rowsProcessed: summary.generated, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}

// Vercel Cron invokes scheduled endpoints with GET; alias the handler so
// the scheduler reaches it (previously 405ed, so these crons never ran).
export const GET = POST;
