// Budget guardrail evaluator. The anti-noise guardrail every credible rule
// engine in this space uses (Revealbot-style, not single-datapoint
// triggers): a metric must hold true for EVERY day in `hold_days`, not just
// an aggregate average across the window — one bad day shouldn't fire a
// rule, and neither should one great day mask three bad ones.

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/integrations/platform-crypto";
import { resolveConnectionById } from "@/lib/composio/resolve-alias";
import { pauseMetaCampaign, updateMetaCampaignBudget, MetaAdsNotSupportedError } from "@/lib/composio/ads-executors";
import { pauseTikTokCampaign, updateTikTokAdGroupBudget } from "@/lib/integrations/tiktok-ads";
import { recordAdBudgetRuleRun, markAdBudgetRuleEvaluated } from "@/lib/services/ad-budget-rules";
import { insertCoachActionAdmin } from "@/lib/services/coach";
import type { AdBudgetRuleRecord, AdInsightsLevel, AdPlatformKind } from "@/lib/types/ads-platform";

interface Target {
  externalId: string;
  level: AdInsightsLevel;
  // For write actions — Meta pause/budget-update only has a dedicated
  // tool at campaign granularity (see ads-executors.ts), so an adset-scope
  // rule's action target is the PARENT campaign's external_id.
  actionExternalId: string;
}

async function resolveTargets(rule: AdBudgetRuleRecord, adAccountId: string): Promise<Target[]> {
  const admin = createAdminClient();

  if (rule.scope === "account") {
    const { data } = await admin.from("ad_campaigns").select("external_id").eq("ad_account_id", adAccountId).eq("status", "active");
    return (data ?? []).map((c) => ({ externalId: c.external_id, level: "campaign" as const, actionExternalId: c.external_id }));
  }

  if (rule.scope === "campaign") {
    if (rule.targetExternalId) {
      return [{ externalId: rule.targetExternalId, level: "campaign", actionExternalId: rule.targetExternalId }];
    }
    const { data } = await admin.from("ad_campaigns").select("external_id").eq("ad_account_id", adAccountId).eq("status", "active");
    return (data ?? []).map((c) => ({ externalId: c.external_id, level: "campaign" as const, actionExternalId: c.external_id }));
  }

  // scope === 'adset'
  const { data: campaigns } = await admin.from("ad_campaigns").select("id, external_id").eq("ad_account_id", adAccountId);
  const campaignIdToExternal = new Map((campaigns ?? []).map((c) => [c.id, c.external_id]));
  let adSetQuery = admin.from("ad_sets").select("external_id, ad_campaign_id").eq("status", "active").in("ad_campaign_id", [...campaignIdToExternal.keys()]);
  if (rule.targetExternalId) adSetQuery = adSetQuery.eq("external_id", rule.targetExternalId);
  const { data: adSets } = await adSetQuery;
  return (adSets ?? []).map((a) => ({
    externalId: a.external_id,
    level: "adset" as const,
    actionExternalId: campaignIdToExternal.get(a.ad_campaign_id) ?? a.external_id,
  }));
}

function metricValueForDay(row: {
  spend: number;
  conversions: number;
  conversion_value: number;
  ctr: number | null;
  frequency: number | null;
  cpm: number | null;
}, metric: AdBudgetRuleRecord["metric"]): number | null {
  switch (metric) {
    case "spend":
      return row.spend;
    case "cpa":
      return row.conversions > 0 ? row.spend / row.conversions : null; // no conversions = undefined CPA, not zero
    case "roas":
      return row.spend > 0 ? row.conversion_value / row.spend : null;
    case "ctr":
      return row.ctr;
    case "frequency":
      return row.frequency;
    case "cpm":
      return row.cpm;
    default:
      return null;
  }
}

function comparatorHolds(value: number, comparator: AdBudgetRuleRecord["comparator"], threshold: number): boolean {
  switch (comparator) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
  }
}

async function takeAction(
  rule: AdBudgetRuleRecord,
  platform: AdPlatformKind,
  adAccountId: string,
  target: Target
): Promise<string> {
  if (rule.action === "notify_only") return "notified";

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("ad_accounts")
    .select("connected_account_id, tiktok_connection_id, external_account_id")
    .eq("id", adAccountId)
    .single();
  if (!account) throw new Error("ad account not found");

  if (platform === "meta") {
    const conn = await resolveConnectionById(account.connected_account_id ?? "");
    if (!conn) throw new Error("Meta connection is no longer active");
    if (rule.action === "pause") {
      await pauseMetaCampaign(conn, target.actionExternalId);
      return "paused";
    }
    // increase/decrease_budget — needs the campaign's current budget to
    // apply a percentage change; fetched fresh rather than trusting a
    // possibly-stale local cache.
    const { data: campaignRow } = await admin
      .from("ad_campaigns")
      .select("budget_amount, budget_mode")
      .eq("ad_account_id", adAccountId)
      .eq("external_id", target.actionExternalId)
      .single();
    if (!campaignRow?.budget_amount || campaignRow.budget_mode === "adset_managed") {
      throw new Error("Campaign has no campaign-level budget to adjust (likely ad-set-managed budget)");
    }
    const pct = (rule.actionAmountPct ?? 20) / 100;
    const delta = rule.action === "increase_budget" ? 1 + pct : 1 - pct;
    const newBudgetMinorUnits = Math.round(campaignRow.budget_amount * delta * 100);
    await updateMetaCampaignBudget(conn, target.actionExternalId, campaignRow.budget_mode === "daily" ? "daily" : "lifetime", newBudgetMinorUnits);
    return `budget ${rule.action === "increase_budget" ? "increased" : "decreased"} ${Math.round(pct * 100)}%`;
  }

  // TikTok
  const { data: connRow } = await admin
    .from("tiktok_ads_connections")
    .select("access_token_enc, status")
    .eq("id", account.tiktok_connection_id ?? "")
    .maybeSingle();
  if (!connRow || connRow.status !== "active") throw new Error("TikTok connection is no longer active");
  const accessToken = decryptToken(connRow.access_token_enc);

  if (rule.action === "pause") {
    await pauseTikTokCampaign(accessToken, account.external_account_id, target.actionExternalId);
    return "paused";
  }
  if (rule.scope === "adset") {
    const { data: adSetRow } = await admin.from("ad_sets").select("budget_amount").eq("external_id", target.externalId).single();
    const pct = (rule.actionAmountPct ?? 20) / 100;
    const delta = rule.action === "increase_budget" ? 1 + pct : 1 - pct;
    const newBudget = Math.round((adSetRow?.budget_amount ?? 0) * delta);
    await updateTikTokAdGroupBudget(accessToken, account.external_account_id, target.externalId, newBudget);
    return `budget ${rule.action === "increase_budget" ? "increased" : "decreased"} ${Math.round(pct * 100)}%`;
  }
  throw new Error("Budget change requires ad-set scope on TikTok (campaign-level budget API not wired)");
}

export async function evaluateAdBudgetRule(rule: AdBudgetRuleRecord): Promise<void> {
  const admin = createAdminClient();

  // A tenant-wide rule (no ad_account_id) evaluates across every active
  // account; an account-scoped rule only that one.
  const accountsQuery = rule.adAccountId
    ? admin.from("ad_accounts").select("id, platform").eq("id", rule.adAccountId).eq("status", "active")
    : admin.from("ad_accounts").select("id, platform").eq("tenant_slug", rule.tenantSlug).eq("status", "active");
  const { data: accounts } = await accountsQuery;

  for (const account of accounts ?? []) {
    const targets = await resolveTargets(rule, account.id);

    for (const target of targets) {
      const since = new Date(Date.now() - rule.holdDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: rows } = await admin
        .from("ad_insights_daily")
        .select("date, spend, conversions, conversion_value, ctr, frequency, cpm")
        .eq("ad_account_id", account.id)
        .eq("level", target.level)
        .eq("external_id", target.externalId)
        .gte("date", since)
        .order("date", { ascending: true });

      if (!rows || rows.length < rule.holdDays) {
        // Not enough history yet — don't fire on partial data.
        continue;
      }

      const dailyValues = rows.map((r) => metricValueForDay(r, rule.metric));
      const allDefined = dailyValues.every((v): v is number => v !== null);
      const conditionMet = allDefined && dailyValues.every((v) => comparatorHolds(v, rule.comparator, rule.threshold));
      const latestValue = dailyValues[dailyValues.length - 1];

      let actionTaken: string | null = null;
      let notes: string | null = null;
      if (conditionMet) {
        try {
          actionTaken = await takeAction(rule, account.platform, account.id, target);
        } catch (err) {
          notes =
            err instanceof MetaAdsNotSupportedError
              ? err.message
              : `Action failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      await recordAdBudgetRuleRun({
        ruleId: rule.id,
        tenantSlug: rule.tenantSlug,
        targetExternalId: target.externalId,
        conditionMet,
        actionTaken,
        metricValue: latestValue,
        notes,
      });

      if (conditionMet) {
        const metricLabel = `${rule.metric.toUpperCase()} ${rule.comparator} ${rule.threshold}`;
        const outcome = actionTaken ?? (notes ? `action failed: ${notes}` : "no action taken");
        await insertCoachActionAdmin({
          tenantSlug: rule.tenantSlug,
          sourceId: rule.id,
          title: `Budget rule "${rule.name}" fired`,
          description: `${target.externalId} held ${metricLabel} for ${rule.holdDays} day${rule.holdDays === 1 ? "" : "s"} (latest: ${latestValue?.toFixed(2) ?? "—"}). Outcome: ${outcome}.`,
          impactArea: "Ads",
          priority: rule.action === "pause" || notes ? 1 : 2,
          ctaLabel: "Review in Ads",
          actionHref: "/ads-tracker",
        });
      }
    }
  }

  await markAdBudgetRuleEvaluated(rule.id);
}
