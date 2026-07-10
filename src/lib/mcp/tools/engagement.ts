import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { listInboxItems, draftAndSaveReply, markInboxReplied } from "@/lib/services/engagement";
import { getTenantMeta } from "@/lib/services/tenants";

const PLATFORMS = ["instagram", "tiktok", "twitter", "linkedin"] as const;

export function registerEngagementTools(server: McpServer) {
  server.registerTool(
    "pulse_inbox",
    {
      title: "List comments/DMs needing a response",
      description: "Comments and DMs needing a response, optionally filtered to unanswered only. Read-only, paginated.",
      inputSchema: {
        platform: z.enum(PLATFORMS).optional(),
        unanswered: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listInboxItems(admin, tenantSlug, {
        platform: args.platform,
        unansweredOnly: args.unanswered,
        limit,
        offset,
      });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_reply_draft",
    {
      title: "Draft an on-brand reply",
      description:
        "Generate an on-brand reply draft for an inbox item (from pulse_inbox) and save it to the item's approval queue. Mutates data — calls an LLM.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const tenant = await getTenantMeta(admin, tenantSlug);
      if (!tenant) return mcpToolError("Tenant not found");
      const result = await draftAndSaveReply(admin, tenantSlug, tenant.name, id);
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_mark_replied",
    {
      title: "Mark an inbox item handled",
      description: "Mark an inbox item handled once the reply was posted manually through a browser. Mutates data.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await markInboxReplied(admin, tenantSlug, id);
      if (!result.ok) return mcpToolError(result.error ?? "Inbox item not found");
      return mcpToolResult({ success: true });
    }
  );
}
