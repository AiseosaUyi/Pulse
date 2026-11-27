// Daily: share unowned leads among each workspace's team, for workspaces that
// turned it on in Settings > Team. See src/lib/outbound/assign-leads.ts.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { assignNewLeads, readLeadAssignment } from "@/lib/outbound/assign-leads";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const result = await withCronRun("assign-leads", async () => {
    const admin = createAdminClient();
    const { data: tenants, error } = await admin.from("tenants").select("slug, settings");
    if (error || !tenants) throw new Error(error?.message ?? "Failed to list tenants");

    const summary = { tenants: 0, assigned: 0, errors: [] as string[] };
    for (const t of tenants) {
      const cfg = readLeadAssignment(t.settings);
      if (!cfg.enabled) continue;
      summary.tenants++;
      try {
        const r = await assignNewLeads(admin, t.slug as string, cfg);
        summary.assigned += r.assigned;
      } catch (err) {
        summary.errors.push(`${t.slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return {
      status: (summary.errors.length ? (summary.assigned ? "partial" : "failed") : "ok") as "ok" | "partial" | "failed",
      rowsProcessed: summary.assigned,
      metadata: summary,
    };
  });
  return NextResponse.json(result.metadata ?? result);
}

// Vercel Cron calls GET.
export const GET = POST;
