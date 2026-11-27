// Every 30 minutes: read replies, send the daily approval digest, send
// approved outreach email. Only workspaces whose mailbox an owner turned on
// are touched. See src/lib/outreach-autopilot/runner.ts.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { listEnabledMailboxTenants } from "@/lib/outreach-autopilot/mailbox";
import { runAutopilotForTenant, type TenantPassResult } from "@/lib/outreach-autopilot/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const result = await withCronRun("outreach-autopilot", async () => {
    const admin = createAdminClient();
    const tenants = await listEnabledMailboxTenants(admin);
    const passes: TenantPassResult[] = [];
    for (const slug of tenants) {
      passes.push(await runAutopilotForTenant(admin, slug));
    }
    const errors = passes.flatMap((p) => p.errors.map((e) => `${p.tenantSlug}: ${e}`));
    return {
      status: errors.length ? ("partial" as const) : ("ok" as const),
      rowsProcessed: passes.reduce((n, p) => n + (p.send?.sent ?? 0), 0),
      metadata: { passes, errors },
    };
  });

  return NextResponse.json(result);
}
