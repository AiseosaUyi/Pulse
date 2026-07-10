import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { listIntelFeed, listCompetitors } from "@/lib/services/intelligence";
import { listTrendScoutsApi } from "@/lib/services/trends";

const CONTENT_TYPES = ["reel", "post", "story", "blog", "video", "thread"] as const;
const TREND_PLATFORMS = ["instagram", "tiktok", "twitter"] as const;
const TREND_SOURCES = ["creative_center", "hashtag_scout", "manual"] as const;

export function registerIntelTools(server: McpServer) {
  server.registerTool(
    "pulse_intel_feed",
    {
      title: "List intel feed signals",
      description: "Competitor intel signals, filterable by content type and recency. Read-only, paginated.",
      inputSchema: {
        contentType: z.enum(CONTENT_TYPES).optional(),
        since: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "intel:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listIntelFeed(admin, tenantSlug, {
        contentType: args.contentType,
        since: args.since,
        limit,
        offset,
      });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_trends",
    {
      title: "List viral/trend signals",
      description: "Current viral/trend signals scouted for the tenant's niche. Read-only, paginated.",
      inputSchema: {
        platform: z.enum(TREND_PLATFORMS).optional(),
        source: z.enum(TREND_SOURCES).optional(),
        includeDismissed: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "intel:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listTrendScoutsApi(admin, tenantSlug, {
        platform: args.platform,
        source: args.source,
        includeDismissed: args.includeDismissed,
        limit,
        offset,
      });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_competitors",
    {
      title: "List competitors",
      description:
        "The tenant's tracked competitor set. Note: no 'latest deltas' computation exists yet — this returns each competitor's static snapshot (handle, followers, engagement rate, last checked). Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "intel:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const data = await listCompetitors(admin, tenantSlug);
      return mcpToolResult({ data });
    }
  );
}
