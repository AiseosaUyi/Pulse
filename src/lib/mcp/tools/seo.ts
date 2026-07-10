import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { listSeoRecommendations, listKeywordRankingsApi, getTopicalMapApi } from "@/lib/services/seo";

const REC_STATUSES = ["surfaced", "applied", "dismissed", "snoozed"] as const;

export function registerSeoTools(server: McpServer) {
  server.registerTool(
    "pulse_seo_recommendations",
    {
      title: "List SEO recommendations",
      description: "Open SEO recommendations ranked by score (default status=surfaced). Read-only, paginated.",
      inputSchema: {
        status: z.enum(REC_STATUSES).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "seo:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listSeoRecommendations(admin, tenantSlug, {
        status: args.status,
        limit,
        offset,
      });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_seo_ranks",
    {
      title: "List tracked keyword ranks",
      description: "Current tracked-keyword rankings. Read-only, paginated.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "seo:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listKeywordRankingsApi(admin, tenantSlug, { limit, offset });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_seo_topical_map",
    {
      title: "Get the latest topical map",
      description:
        "The tenant's latest generated topical map (pre-stored, no LLM call). Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "seo:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const map = await getTopicalMapApi(admin, tenantSlug);
      if (!map) return mcpToolError("No topical map generated yet for this tenant");
      return mcpToolResult(map);
    }
  );
}
