// Daily: find verified emails for leads in every workspace, even ones with no
// outreach mailbox set up. Workspaces whose Autopilot runner already does this
// are skipped. See src/lib/outreach-autopilot/find-emails-job.ts.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { findEmailsForAllTenants } from "@/lib/outreach-autopilot/find-emails-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Each lead can take several page fetches (12s timeout each) plus an MX
// lookup, so stop starting new leads well before the 300s limit.
const RUN_BUDGET_MS = 240_000;
const PER_TENANT_LIMIT = 60;
const PER_TENANT_SEARCH_BUDGET = 30;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const result = await withCronRun("find-lead-emails", async () => {
    const admin = createAdminClient();
    const passes = await findEmailsForAllTenants(admin, {
      deadlineMs: Date.now() + RUN_BUDGET_MS,
      perTenantLimit: PER_TENANT_LIMIT,
      perTenantSearchBudget: PER_TENANT_SEARCH_BUDGET,
    });
    const errors = passes.filter((p) => p.error).map((p) => `${p.tenantSlug}: ${p.error}`);
    return {
      status: errors.length ? ("partial" as const) : ("ok" as const),
      rowsProcessed: passes.reduce((n, p) => n + p.found, 0),
      metadata: { passes, errors },
    };
  });

  return NextResponse.json(result);
}

// Vercel Cron invokes scheduled endpoints with GET.
export const GET = POST;
