import { createAdminClient } from "@/lib/supabase/admin";
import { insertCoachActionAdmin } from "@/lib/services/coach";
import type { AdInsightsLevel } from "@/lib/types/ads-platform";

const ALERT_LABEL: Record<AdAlertRecord["alertType"], string> = {
  creative_fatigue: "Creative fatigue detected",
  disapproved: "An ad was disapproved",
  with_issues: "An ad object has an issue",
  recommendation: "Platform recommendation available",
  cpa_anomaly: "CPA anomaly detected",
  audience_overlap: "Audience overlap detected",
};

export interface AdAlertRecord {
  id: string;
  tenantSlug: string;
  adAccountId: string;
  level: AdInsightsLevel;
  externalId: string;
  alertType: "creative_fatigue" | "disapproved" | "with_issues" | "recommendation" | "cpa_anomaly" | "audience_overlap";
  severity: "low" | "medium" | "high" | null;
  message: string;
  resolved: boolean;
  createdAt: string;
}

export async function createAdAlert(params: {
  tenantSlug: string;
  adAccountId: string;
  level: AdInsightsLevel;
  externalId: string;
  alertType: AdAlertRecord["alertType"];
  severity?: AdAlertRecord["severity"];
  message: string;
  raw?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ad_alerts").insert({
    tenant_slug: params.tenantSlug,
    ad_account_id: params.adAccountId,
    level: params.level,
    external_id: params.externalId,
    alert_type: params.alertType,
    severity: params.severity ?? null,
    message: params.message,
    raw: params.raw ?? {},
  });

  // Only medium/high severity surfaces in the coach feed — low-severity
  // recommendations stay in the Ads alerts panel only, to keep the coach
  // feed to things worth interrupting the operator for.
  if (params.severity === "medium" || params.severity === "high") {
    await insertCoachActionAdmin({
      tenantSlug: params.tenantSlug,
      sourceId: params.externalId,
      title: ALERT_LABEL[params.alertType],
      description: params.message,
      impactArea: "Ads",
      priority: params.severity === "high" ? 1 : 2,
      ctaLabel: "Review in Ads",
      actionHref: "/ads-tracker",
    });
  }
}

export async function listAdAlerts(
  tenantSlug: string,
  opts: { unresolvedOnly?: boolean; limit?: number } = {}
): Promise<AdAlertRecord[]> {
  const admin = createAdminClient();
  let query = admin
    .from("ad_alerts")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.unresolvedOnly) query = query.eq("resolved", false);
  const { data } = await query;
  return (data ?? []).map((r) => ({
    id: r.id,
    tenantSlug: r.tenant_slug,
    adAccountId: r.ad_account_id,
    level: r.level,
    externalId: r.external_id,
    alertType: r.alert_type,
    severity: r.severity,
    message: r.message,
    resolved: r.resolved,
    createdAt: r.created_at,
  }));
}

export async function resolveAdAlert(tenantSlug: string, alertId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("ad_alerts").update({ resolved: true }).eq("id", alertId).eq("tenant_slug", tenantSlug);
}
