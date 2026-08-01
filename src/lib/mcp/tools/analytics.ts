import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { getDashboardStatsApi } from "@/lib/services/dashboard";
import { listOwnMetricsApi } from "@/lib/services/own-metrics";
import { getLatestWeeklyReviewApi } from "@/lib/services/weekly-reviews";
import { listCampaignsApi, getCampaignSummaryApi } from "@/lib/services/campaigns";

const PLATFORMS = ["instagram", "tiktok", "twitter", "linkedin"] as const;
const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed"] as const;

export function registerAnalyticsTools(server: McpServer) {
  server.registerTool(
    "pulse_analytics_overview",
    {
      title: "Get dashboard KPIs",
      description:
        "Dashboard overview: social reach this week vs last, active prospect pipeline, active campaign spend, connected platforms. Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const stats = await getDashboardStatsApi(admin, tenantSlug);
      if (!stats) return mcpToolError("Tenant not found");
      return mcpToolResult(stats);
    }
  );

  server.registerTool(
    "pulse_post_insights",
    {
      title: "List per-post engagement insights",
      description:
        "Per-post engagement metrics, filterable by platform/recency — reads the same table pulse_record_post_metrics writes to, so a manager's own recorded engagement shows up immediately. Read-only, paginated.",
      inputSchema: {
        platform: z.enum(PLATFORMS).optional(),
        since: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listOwnMetricsApi(admin, tenantSlug, {
        platform: args.platform,
        since: args.since,
        limit,
        offset,
      });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_ads_overview",
    {
      title: "Get ad campaign summary",
      description:
        "Aggregate ad-campaign totals: spend, revenue, ROAS, impressions/clicks/conversions, active vs total campaign count. Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const summary = await getCampaignSummaryApi(admin, tenantSlug);
      return mcpToolResult(summary);
    }
  );

  server.registerTool(
    "pulse_list_campaigns",
    {
      title: "List ad campaigns",
      description:
        "Per-campaign detail (platform, status, spend, revenue, ROAS, dates) behind the pulse_ads_overview totals. Read-only, paginated.",
      inputSchema: {
        status: z.enum(CAMPAIGN_STATUSES).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listCampaignsApi(admin, tenantSlug, { status: args.status, limit, offset });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_weekly_review",
    {
      title: "Get the latest weekly business review",
      description: "The latest generated weekly business-review narrative (pre-stored, no LLM call). Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "analytics:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const review = await getLatestWeeklyReviewApi(admin, tenantSlug);
      if (!review) return mcpToolError("No weekly review generated yet for this tenant");
      return mcpToolResult(review);
    }
  );
}
