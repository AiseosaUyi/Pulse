"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import { setAdCampaignUtmMapping } from "@/lib/attribution/ads";
import {
  createAdBudgetRule,
  setAdBudgetRuleEnabled,
  deleteAdBudgetRule,
} from "@/lib/services/ad-budget-rules";
import {
  updateAdAccountPixelConfig,
  getMetaAdAccountWebhookCredentials,
  disableAdAccountsByTikTokConnection,
} from "@/lib/services/ad-accounts";
import { subscribeMetaAdAccountWebhook } from "@/lib/integrations/meta-capi";
import { disconnectTikTokAds } from "@/lib/services/tiktok-ads-connections";
import type { BudgetRuleAction, BudgetRuleComparator, BudgetRuleMetric, BudgetRuleScope } from "@/lib/types/ads-platform";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function confirmAdCampaignUtmMapping(
  adAccountId: string,
  campaignExternalId: string,
  utmCampaign: string
): Promise<ActionResult> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  void user;
  try {
    await setAdCampaignUtmMapping(tenant.slug, adAccountId, campaignExternalId, utmCampaign);
    revalidatePath("/ads-tracker");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to save mapping" };
  }
}

export async function createBudgetRuleAction(input: {
  adAccountId?: string;
  name: string;
  scope: BudgetRuleScope;
  targetExternalId?: string;
  metric: BudgetRuleMetric;
  comparator: BudgetRuleComparator;
  threshold: number;
  holdDays?: number;
  action: BudgetRuleAction;
  actionAmountPct?: number;
}): Promise<ActionResult> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { success: false, error: "Only owners or admins can create budget rules" };
  }
  try {
    await createAdBudgetRule({ tenantSlug: tenant.slug, createdBy: user.id, ...input });
    revalidatePath("/ads-tracker");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create rule" };
  }
}

export async function toggleBudgetRuleAction(ruleId: string, enabled: boolean): Promise<ActionResult> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  await setAdBudgetRuleEnabled(tenant.slug, ruleId, enabled);
  revalidatePath("/ads-tracker");
  return { success: true };
}

export async function deleteBudgetRuleAction(ruleId: string): Promise<ActionResult> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  await deleteAdBudgetRule(tenant.slug, ruleId);
  revalidatePath("/ads-tracker");
  return { success: true };
}

export async function savePixelConfigAction(
  adAccountId: string,
  input: { metaPixelId?: string | null; metaCapiToken?: string | null; tiktokPixelCode?: string | null }
): Promise<ActionResult> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { success: false, error: "Only owners or admins can edit conversion tracking config" };
  }
  try {
    await updateAdAccountPixelConfig({ tenantSlug: tenant.slug, adAccountId, ...input });
    revalidatePath("/settings/integrations");
    revalidatePath("/ads-tracker");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to save conversion tracking config" };
  }
}

export async function subscribeMetaWebhookAction(adAccountId: string): Promise<ActionResult> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { success: false, error: "Only owners or admins can manage webhook alerts" };
  }
  const creds = await getMetaAdAccountWebhookCredentials(tenant.slug, adAccountId);
  if (!creds) {
    return { success: false, error: "Save a Conversions API token for this account first — the webhook subscribe call reuses it." };
  }
  try {
    await subscribeMetaAdAccountWebhook(creds.externalAccountId, creds.accessToken);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Webhook subscription failed" };
  }
}

export async function disconnectTikTokAdsAction(connectionId: string): Promise<ActionResult> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { success: false, error: "Only owners or admins can disconnect ad accounts" };
  }
  await disconnectTikTokAds(tenant.slug, connectionId);
  await disableAdAccountsByTikTokConnection(tenant.slug, connectionId);
  revalidatePath("/settings/integrations");
  revalidatePath("/ads-tracker");
  return { success: true };
}
