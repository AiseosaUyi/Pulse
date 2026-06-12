import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { generateWeeklyDigest } from "@/lib/actions/weekly-digest";

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
  }

  console.log("[cron/weekly-digest] complete", summary);
    const status =
      summary.failed === 0 ? "ok" : summary.generated > 0 ? "partial" : "failed";
    return { status, rowsProcessed: summary.generated, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}
