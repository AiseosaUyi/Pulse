import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { listPublishQueue, recordManualPublish, recordManualMetrics } from "@/lib/services/scheduled-posts";
import { resolveTenantMediaKey } from "@/lib/services/media";

const PLATFORMS = ["x", "linkedin", "instagram", "tiktok", "youtube"] as const;
const STATUSES = ["draft", "scheduled", "publishing", "published", "failed"] as const;

export function registerPublishingTools(server: McpServer) {
  server.registerTool(
    "pulse_publish_queue",
    {
      title: "List posts awaiting manual publishing",
      description:
        "Approved/scheduled posts awaiting manual publishing through a real browser (direct API posting isn't used — too costly). Defaults to status=scheduled. Read-only, paginated.",
      inputSchema: {
        platform: z.enum(PLATFORMS).optional(),
        status: z.enum(STATUSES).optional(),
        due: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "publish:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listPublishQueue(admin, tenantSlug, {
        platform: args.platform,
        status: args.status,
        due: args.due,
        limit,
        offset,
      });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_post_media",
    {
      title: "Resolve a post's media to a downloadable URL",
      description:
        "Resolve a `mediaPaths` entry (from pulse_publish_queue) to a downloadable URL, so the media can be attached when posting manually through a browser. Read-only.",
      inputSchema: { path: z.string().min(1).describe("A raw mediaPaths entry, e.g. 'assets/gruve/202607/abc.jpg'") },
    },
    async ({ path }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "publish:read");
      if (!gate.ok) return gate.error;
      const result = await resolveTenantMediaKey(gate.context.tenantSlug, path.split("/"));
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_record_published",
    {
      title: "Record a successful manual post",
      description:
        "Record that a post from pulse_publish_queue was successfully published manually through a browser. Sets status to 'published'. Mutates data.",
      inputSchema: {
        id: z.string().uuid(),
        platformPostId: z.string().min(1),
        platformPostUrl: z.string().min(1),
        postedAt: z.string().datetime().optional(),
      },
    },
    async ({ id, ...input }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "publish:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await recordManualPublish(admin, tenantSlug, id, input);
      if (!result.ok) return mcpToolError(result.error);
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_record_post_metrics",
    {
      title: "Record observed post engagement",
      description:
        "Record engagement (likes/comments/shares/saves/views) observed on-platform for a published post. At least one metric is required. Mutates data.",
      inputSchema: {
        id: z.string().uuid(),
        likes: z.number().int().min(0).optional(),
        comments: z.number().int().min(0).optional(),
        shares: z.number().int().min(0).optional(),
        saves: z.number().int().min(0).optional(),
        views: z.number().int().min(0).optional(),
        observedAt: z.string().datetime().optional(),
        notes: z.string().optional(),
      },
    },
    async ({ id, ...input }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "publish:write");
      if (!gate.ok) return gate.error;
      if (
        input.likes === undefined &&
        input.comments === undefined &&
        input.shares === undefined &&
        input.saves === undefined &&
        input.views === undefined
      ) {
        return mcpToolError("At least one metric (likes/comments/shares/saves/views) is required");
      }
      const { tenantSlug, admin } = gate.context;
      const result = await recordManualMetrics(admin, tenantSlug, id, input);
      if (!result.ok) return mcpToolError(result.error);
      return mcpToolResult({ success: true });
    }
  );
}
