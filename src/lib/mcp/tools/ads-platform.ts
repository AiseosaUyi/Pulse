import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { listAdAccountsForTenant } from "@/lib/services/ad-accounts";
import { getAdCampaignRoas, getAdRoasSummary, setAdCampaignUtmMapping } from "@/lib/attribution/ads";
import { listCompetitorAds, getCompetitorVariantCounts } from "@/lib/services/competitor-ads";
import { listAdBudgetRules, createAdBudgetRule, setAdBudgetRuleEnabled, deleteAdBudgetRule, listAdBudgetRuleRuns } from "@/lib/services/ad-budget-rules";
import { listAdAlerts, resolveAdAlert } from "@/lib/services/ad-alerts";

const BUDGET_RULE_METRICS = ["cpa", "roas", "ctr", "frequency", "spend", "cpm"] as const;
const BUDGET_RULE_COMPARATORS = ["gt", "lt", "gte", "lte"] as const;
const BUDGET_RULE_ACTIONS = ["pause", "notify_only", "increase_budget", "decrease_budget"] as const;
const BUDGET_RULE_SCOPES = ["account", "campaign", "adset"] as const;

export function registerAdsPlatformTools(server: McpServer) {
  server.registerTool(
    "pulse_ad_accounts",
    {
      title: "List connected ad accounts",
      description: "Real Meta/TikTok ad accounts connected to this tenant, with sync status. Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      const accounts = await listAdAccountsForTenant(tenantSlug);
      return mcpToolResult({ data: accounts });
    }
  );

  server.registerTool(
    "pulse_ad_roas",
    {
      title: "Get real (blended) ROAS",
      description:
        "Ad spend from connected Meta/TikTok accounts joined against Pulse's own order data — the actual revenue attribution, not the platform's self-reported number. Also returns per-campaign breakdown with match confidence. Read-only.",
      inputSchema: { days: z.number().int().min(1).max(365).optional() },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      const days = args.days ?? 30;
      const [summary, campaigns] = await Promise.all([getAdRoasSummary(tenantSlug, days), getAdCampaignRoas(tenantSlug, days)]);
      return mcpToolResult({ summary, campaigns });
    }
  );

  server.registerTool(
    "pulse_set_ad_campaign_utm",
    {
      title: "Confirm/correct a campaign's UTM attribution mapping",
      description:
        "Sets the utm_campaign value used to match this ad campaign's spend against real orders for blended ROAS. Use after verifying pulse_ad_roas's guessed match is correct (or to fix a wrong guess). Mutates data.",
      inputSchema: {
        adAccountId: z.string().uuid(),
        campaignExternalId: z.string().min(1),
        utmCampaign: z.string().min(1),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      await setAdCampaignUtmMapping(tenantSlug, args.adAccountId, args.campaignExternalId, args.utmCampaign);
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_competitor_ads",
    {
      title: "List tracked competitor ads",
      description:
        "Competitor ads discovered via Meta's Ad Library — longest-running first (ad longevity is the real signal: still-running ads are evidence they're working). Read-only.",
      inputSchema: {
        competitorId: z.string().uuid().optional(),
        activeOnly: z.boolean().optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "intel:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      const ads = await listCompetitorAds(tenantSlug, { competitorId: args.competitorId, activeOnly: args.activeOnly });
      return mcpToolResult({ data: ads });
    }
  );

  server.registerTool(
    "pulse_competitor_ad_variants",
    {
      title: "Get a competitor's creative variant counts",
      description:
        "How many versions of each ad concept a competitor is currently running — a high variant count signals aggressive creative testing, the more actionable read than any single ad's copy. Read-only.",
      inputSchema: { competitorId: z.string().uuid() },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "intel:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      const variants = await getCompetitorVariantCounts(tenantSlug, args.competitorId);
      return mcpToolResult({ data: variants });
    }
  );

  server.registerTool(
    "pulse_list_ad_budget_rules",
    {
      title: "List ad budget guardrail rules",
      description: "User-authored automation rules (pause/reallocate budget on CPA/ROAS thresholds). Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      const rules = await listAdBudgetRules(tenantSlug);
      return mcpToolResult({ data: rules });
    }
  );

  server.registerTool(
    "pulse_create_ad_budget_rule",
    {
      title: "Create an ad budget guardrail rule",
      description:
        "Automates pausing/reallocating budget when a metric (CPA/ROAS/CTR/frequency/spend/CPM) crosses a threshold and holds for N consecutive days (anti-noise — a single bad day never fires it). Mutates data — takes real action on the connected ad platform once triggered.",
      inputSchema: {
        adAccountId: z.string().uuid().optional(),
        name: z.string().min(1),
        scope: z.enum(BUDGET_RULE_SCOPES),
        targetExternalId: z.string().optional(),
        metric: z.enum(BUDGET_RULE_METRICS),
        comparator: z.enum(BUDGET_RULE_COMPARATORS),
        threshold: z.number(),
        holdDays: z.number().int().min(1).max(14).optional(),
        action: z.enum(BUDGET_RULE_ACTIONS),
        actionAmountPct: z.number().min(1).max(100).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "publish:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, createdBy } = gate.context;
      const rule = await createAdBudgetRule({
        tenantSlug,
        adAccountId: args.adAccountId,
        name: args.name,
        scope: args.scope,
        targetExternalId: args.targetExternalId,
        metric: args.metric,
        comparator: args.comparator,
        threshold: args.threshold,
        holdDays: args.holdDays,
        action: args.action,
        actionAmountPct: args.actionAmountPct,
        createdBy,
      });
      return mcpToolResult({ rule });
    }
  );

  server.registerTool(
    "pulse_set_ad_budget_rule_enabled",
    {
      title: "Enable or disable a budget rule",
      description: "Turns an ad budget guardrail rule on/off without deleting it. Mutates data.",
      inputSchema: { ruleId: z.string().uuid(), enabled: z.boolean() },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "publish:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      await setAdBudgetRuleEnabled(tenantSlug, args.ruleId, args.enabled);
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_delete_ad_budget_rule",
    {
      title: "Delete a budget rule",
      description: "Permanently removes an ad budget guardrail rule. Mutates data.",
      inputSchema: { ruleId: z.string().uuid() },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "publish:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      await deleteAdBudgetRule(tenantSlug, args.ruleId);
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_ad_budget_rule_runs",
    {
      title: "Get a budget rule's evaluation history",
      description: "Every time this rule was checked, whether its condition held, and what action (if any) was taken. Read-only.",
      inputSchema: { ruleId: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      const runs = await listAdBudgetRuleRuns(tenantSlug, args.ruleId, args.limit);
      return mcpToolResult({ data: runs });
    }
  );

  server.registerTool(
    "pulse_ad_alerts",
    {
      title: "List ad alerts",
      description: "Creative fatigue, delivery issues, and platform recommendations surfaced from connected ad accounts. Read-only.",
      inputSchema: { unresolvedOnly: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      const alerts = await listAdAlerts(tenantSlug, { unresolvedOnly: args.unresolvedOnly, limit: args.limit });
      return mcpToolResult({ data: alerts });
    }
  );

  server.registerTool(
    "pulse_resolve_ad_alert",
    {
      title: "Mark an ad alert resolved",
      description: "Dismisses an ad alert once addressed. Mutates data.",
      inputSchema: { alertId: z.string().uuid() },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug } = gate.context;
      await resolveAdAlert(tenantSlug, args.alertId);
      return mcpToolResult({ success: true });
    }
  );
}
