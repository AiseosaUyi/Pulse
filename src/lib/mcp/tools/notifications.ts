import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { hasScope } from "@/lib/api/scopes";
import { createApprovalRequest, getApprovalContext, listPendingApprovals } from "@/lib/services/approvals";
import { deliverApprovalLink } from "@/lib/approvals/deliver";
import { isApprovalsConfigured } from "@/lib/approvals/token";

export function registerNotificationsTools(server: McpServer) {
  server.registerTool(
    "pulse_send_briefing",
    {
      title: "Send a briefing for approval",
      description:
        "Send a scheduled post or content brief to a human for approval, edit, or rejection via a signed one-time link, delivered by email or WhatsApp. Approving a scheduled post schedules/publishes it through the existing pipeline; approving a brief marks it approved. Mutates data.",
      inputSchema: {
        targetType: z.enum(["scheduled_post", "content_brief"]),
        targetId: z.string().uuid(),
        deliveredVia: z.enum(["email", "whatsapp"]),
        deliveredTo: z.string().min(1),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      // Scope depends on targetType, same reasoning as the REST route —
      // requireToolScope takes one fixed scope, so gate manually here.
      const requiredScope = args.targetType === "scheduled_post" ? "publish:write" : "content:write";
      const gate = requireToolScope(extra, null);
      if (!gate.ok) return gate.error;
      if (!hasScope(gate.context.scopes, requiredScope)) {
        return mcpToolError(`Missing required scope: ${requiredScope}`);
      }
      if (!isApprovalsConfigured()) {
        return mcpToolError("Approval links aren't configured (APPROVAL_TOKEN_SECRET unset)");
      }
      const { tenantSlug, admin, createdBy } = gate.context;

      const minted = await createApprovalRequest(admin, tenantSlug, {
        targetType: args.targetType,
        targetId: args.targetId,
        deliveredVia: args.deliveredVia,
        deliveredTo: args.deliveredTo,
        createdBy,
      });
      if ("error" in minted) return mcpToolError(minted.error);

      const ctx = await getApprovalContext(admin, minted.requestId);
      if (ctx.state === "not_found") return mcpToolError("Target vanished after creation");

      const delivery = await deliverApprovalLink(
        args.deliveredVia,
        args.deliveredTo,
        tenantSlug,
        ctx.target,
        minted.url
      );
      if (!delivery.ok) return mcpToolError(`Approval request created but delivery failed: ${delivery.error}`);

      return mcpToolResult({ requestId: minted.requestId, expiresAt: minted.expiresAt });
    }
  );

  server.registerTool(
    "pulse_list_pending_approvals",
    {
      title: "List pending approval requests",
      description: "Approval links sent but not yet actioned (approved/rejected/expired-but-not-yet-swept). Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const data = await listPendingApprovals(admin, tenantSlug);
      return mcpToolResult({ data });
    }
  );
}
