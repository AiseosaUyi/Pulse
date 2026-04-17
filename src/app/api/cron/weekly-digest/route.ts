import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateWeeklyDigest } from "@/lib/actions/weekly-digest";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    return NextResponse.json(
      { error: tenantsErr?.message ?? "Failed to list tenants" },
      { status: 500 }
    );
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
  return NextResponse.json(summary);
}
