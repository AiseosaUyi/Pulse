// Budget guardrail rules — CRUD + read helpers. Evaluation logic lives in
// ad-budget-rule-engine.ts (kept separate since the evaluator needs the ads
// clients, which this CRUD layer shouldn't depend on).

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  BudgetRuleAction,
  AdBudgetRuleRecord,
  AdBudgetRuleRunRecord,
  BudgetRuleComparator,
  BudgetRuleMetric,
  BudgetRuleScope,
} from "@/lib/types/ads-platform";

function ruleRowTo(r: Record<string, unknown>): AdBudgetRuleRecord {
  return {
    id: r.id as string,
    tenantSlug: r.tenant_slug as string,
    adAccountId: (r.ad_account_id as string) ?? null,
    name: r.name as string,
    scope: r.scope as BudgetRuleScope,
    targetExternalId: (r.target_external_id as string) ?? null,
    metric: r.metric as BudgetRuleMetric,
    comparator: r.comparator as BudgetRuleComparator,
    threshold: Number(r.threshold),
    holdDays: r.hold_days as number,
    action: r.action as BudgetRuleAction,
    actionAmountPct: r.action_amount_pct != null ? Number(r.action_amount_pct) : null,
    enabled: r.enabled as boolean,
    lastEvaluatedAt: (r.last_evaluated_at as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export async function createAdBudgetRule(params: {
  tenantSlug: string;
  adAccountId?: string | null;
  name: string;
  scope: BudgetRuleScope;
  targetExternalId?: string | null;
  metric: BudgetRuleMetric;
  comparator: BudgetRuleComparator;
  threshold: number;
  holdDays?: number;
  action: BudgetRuleAction;
  actionAmountPct?: number | null;
  createdBy?: string | null;
}): Promise<AdBudgetRuleRecord> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ad_budget_rules")
    .insert({
      tenant_slug: params.tenantSlug,
      ad_account_id: params.adAccountId ?? null,
      name: params.name,
      scope: params.scope,
      target_external_id: params.targetExternalId ?? null,
      metric: params.metric,
      comparator: params.comparator,
      threshold: params.threshold,
      hold_days: params.holdDays ?? 3,
      action: params.action,
      action_amount_pct: params.actionAmountPct ?? null,
      created_by: params.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createAdBudgetRule failed");
  return ruleRowTo(data);
}

export async function listAdBudgetRules(tenantSlug: string): Promise<AdBudgetRuleRecord[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ad_budget_rules")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false });
  return (data ?? []).map(ruleRowTo);
}

export async function listEnabledAdBudgetRules(): Promise<AdBudgetRuleRecord[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("ad_budget_rules").select("*").eq("enabled", true);
  return (data ?? []).map(ruleRowTo);
}

export async function setAdBudgetRuleEnabled(tenantSlug: string, ruleId: string, enabled: boolean): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ad_budget_rules").update({ enabled }).eq("id", ruleId).eq("tenant_slug", tenantSlug);
}

export async function deleteAdBudgetRule(tenantSlug: string, ruleId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ad_budget_rules").delete().eq("id", ruleId).eq("tenant_slug", tenantSlug);
}

export async function listAdBudgetRuleRuns(tenantSlug: string, ruleId: string, limit = 30): Promise<AdBudgetRuleRunRecord[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ad_budget_rule_runs")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("rule_id", ruleId)
    .order("evaluated_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id,
    ruleId: r.rule_id,
    tenantSlug: r.tenant_slug,
    targetExternalId: r.target_external_id,
    conditionMet: r.condition_met,
    actionTaken: r.action_taken,
    metricValue: r.metric_value != null ? Number(r.metric_value) : null,
    notes: r.notes,
    evaluatedAt: r.evaluated_at,
  }));
}

export async function recordAdBudgetRuleRun(params: {
  ruleId: string;
  tenantSlug: string;
  targetExternalId: string;
  conditionMet: boolean;
  actionTaken: string | null;
  metricValue: number | null;
  notes: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ad_budget_rule_runs").insert({
    rule_id: params.ruleId,
    tenant_slug: params.tenantSlug,
    target_external_id: params.targetExternalId,
    condition_met: params.conditionMet,
    action_taken: params.actionTaken,
    metric_value: params.metricValue,
    notes: params.notes,
  });
}

export async function markAdBudgetRuleEvaluated(ruleId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ad_budget_rules").update({ last_evaluated_at: new Date().toISOString() }).eq("id", ruleId);
}
