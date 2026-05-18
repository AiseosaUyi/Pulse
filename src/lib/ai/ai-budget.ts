// Per-tenant monthly AI spend gate. Reads tenants.settings.ai_budget_usd,
// sums ai_call_log.cost_usd month-to-date, returns the verdict.
//
// Call before every generator. Throw BudgetExceededError when over 100%
// to fail fast with a clear UI message ("This month's AI budget is
// exhausted. Bump it in Settings → AI Usage."). Soft-warn at 80% via
// the returned `softWarn` flag so callers can surface a banner.
//
// Why not a daily cap or rate limit? Monthly is the user-facing
// abstraction tenants already understand (it's how /settings/ai-usage
// displays cost). Rate limiting per-tenant is a separate concern and
// can layer on top later if abuse becomes an issue.

import { createAdminClient } from "@/lib/supabase/admin";

export interface BudgetStatus {
  budgetUsd: number | null; // null = no budget set, calls allowed
  spentUsd: number;
  remainingUsd: number | null;
  percentUsed: number; // 0..∞, > 1 means over budget
  softWarn: boolean; // 80% or higher
  exceeded: boolean; // 100% or higher
  periodStart: string; // ISO of month start UTC
}

export class BudgetExceededError extends Error {
  readonly tenantSlug: string;
  readonly status: BudgetStatus;
  constructor(tenantSlug: string, status: BudgetStatus) {
    super(
      `AI budget exceeded for tenant '${tenantSlug}': spent $${status.spentUsd.toFixed(
        2
      )} of $${status.budgetUsd?.toFixed(2) ?? "0"} this month.`
    );
    this.name = "BudgetExceededError";
    this.tenantSlug = tenantSlug;
    this.status = status;
  }
}

function monthStartUtc(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return d.toISOString();
}

export async function getBudgetStatus(
  tenantSlug: string
): Promise<BudgetStatus> {
  const admin = createAdminClient();
  const periodStart = monthStartUtc();

  // Tenant config: budget lives in tenants.settings.ai_budget_usd.
  // No budget set → unlimited (existing behavior pre-SEO module).
  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (tenantErr) throw tenantErr;

  const settings = (tenant?.settings as Record<string, unknown> | null) ?? {};
  const rawBudget = settings.ai_budget_usd;
  const budgetUsd =
    typeof rawBudget === "number" && rawBudget >= 0 ? rawBudget : null;

  // Sum costs MTD. ai_call_log.cost_usd is numeric(8,4) so the totals
  // fit a JS number for any plausible monthly volume.
  const { data: rows, error: sumErr } = await admin
    .from("ai_call_log")
    .select("cost_usd")
    .eq("tenant_slug", tenantSlug)
    .gte("created_at", periodStart);

  if (sumErr) throw sumErr;

  const spentUsd = (rows ?? []).reduce(
    (acc, r) => acc + (Number(r.cost_usd) || 0),
    0
  );

  if (budgetUsd === null) {
    return {
      budgetUsd: null,
      spentUsd,
      remainingUsd: null,
      percentUsed: 0,
      softWarn: false,
      exceeded: false,
      periodStart,
    };
  }

  const percentUsed = budgetUsd > 0 ? spentUsd / budgetUsd : Infinity;
  const remainingUsd = Math.max(0, budgetUsd - spentUsd);

  return {
    budgetUsd,
    spentUsd,
    remainingUsd,
    percentUsed,
    softWarn: percentUsed >= 0.8,
    exceeded: percentUsed >= 1,
    periodStart,
  };
}

// Call this at the top of every generator. Throws when the tenant is
// over budget so the server action can surface the error to the UI.
export async function checkAiBudget(tenantSlug: string): Promise<BudgetStatus> {
  const status = await getBudgetStatus(tenantSlug);
  if (status.exceeded) {
    throw new BudgetExceededError(tenantSlug, status);
  }
  return status;
}
