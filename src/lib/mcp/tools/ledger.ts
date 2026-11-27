import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { ledgerList, ledgerAdd } from "@/lib/services/outreach-ledger";
import { generateRunReport } from "@/lib/services/research-rounds";
import { composeAndSaveDrafts } from "@/lib/services/outreach-composition";
import { recordProspectReply, listWeeklyMissingCapabilities } from "@/lib/services/replies-log";

export function registerLedgerTools(server: McpServer) {
  server.registerTool(
    "ledger_list",
    {
      title: "Query Outreach Ledger",
      description:
        "List/filter the outreach ledger exclusion memory (domains, emails, handles, phones, kind: CONTACTED | DROPPED, run_id). Read-only. Never sends anything (sent: false).",
      inputSchema: {
        domains: z.array(z.string()).optional(),
        emails: z.array(z.string()).optional(),
        handles: z.array(z.string()).optional(),
        phones: z.array(z.string()).optional(),
        kind: z.enum(["CONTACTED", "DROPPED"]).optional(),
        run_id: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await ledgerList(admin, tenantSlug, {
        domains: args.domains,
        emails: args.emails,
        handles: args.handles,
        phones: args.phones,
        kind: args.kind,
        runId: args.run_id,
        limit: args.limit,
      });
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "ledger_add",
    {
      title: "Add Entry to Outreach Ledger",
      description:
        "Add a domain, email, handle, or phone to the outreach exclude ledger with kind CONTACTED or DROPPED. A CONTACTED row is never downgraded to DROPPED. Mutates data. Never sends anything (sent: false).",
      inputSchema: {
        kind: z.enum(["CONTACTED", "DROPPED"]),
        domain: z.string().optional(),
        email: z.string().optional(),
        handle: z.string().optional(),
        phone: z.string().optional(),
        company_name: z.string().optional(),
        reason: z.string().optional(),
        run_id: z.string().optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await ledgerAdd(admin, tenantSlug, {
        kind: args.kind,
        domain: args.domain,
        email: args.email,
        handle: args.handle,
        phone: args.phone,
        companyName: args.company_name,
        reason: args.reason,
        runId: args.run_id,
      });
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "run_report",
    {
      title: "Get Lead Research Round Report",
      description:
        "Produce the exact round summary line and metrics for a research run_id. Read-only. Never sends anything (sent: false).",
      inputSchema: {
        run_id: z.string().min(1).describe("The research run_id"),
      },
    },
    async ({ run_id }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await generateRunReport(admin, tenantSlug, run_id);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_compose_drafts",
    {
      title: "Compose Outreach Drafts (Port build.js)",
      description:
        "Build cold outreach drafts for prospects using venture segment copy (greeting, hook, idea, rotated proof/offer/ask, signature). Lints drafts against banned words, promises, word limits, and punctuation. Saves as drafts in approval queue. Never sends anything (sent: false).",
      inputSchema: {
        run_id: z.string().optional(),
        prospect_ids: z.array(z.string().uuid()).optional(),
        batch_size: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      try {
        const result = await composeAndSaveDrafts(admin, tenantSlug, {
          runId: args.run_id,
          prospectIds: args.prospect_ids,
          batchSize: args.batch_size,
        });
        return mcpToolResult(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return mcpToolError(`Failed to compose drafts: ${msg}`);
      }
    }
  );

  server.registerTool(
    "pulse_record_reply",
    {
      title: "Record a Prospect Reply",
      description:
        "Log a reply from a prospect: date, channel, short quote, status (interested, declined, dormant, closed), next step, and optional missing capability. Mutates data. Never sends anything (sent: false).",
      inputSchema: {
        prospect_id: z.string().uuid().optional(),
        channel: z.string().min(1),
        quote: z.string().min(1),
        status: z.enum(["interested", "declined", "dormant", "closed"]),
        next_step: z.string().optional(),
        missing_capability: z.string().optional().describe("Tag missing capability if decline named one (e.g. 'we only work with X')"),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      try {
        const result = await recordProspectReply(admin, tenantSlug, {
          prospectId: args.prospect_id,
          channel: args.channel,
          quote: args.quote,
          status: args.status,
          nextStep: args.next_step,
          missingCapability: args.missing_capability,
        });
        return mcpToolResult(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return mcpToolError(`Failed to record reply: ${msg}`);
      }
    }
  );

  server.registerTool(
    "pulse_replies_insights",
    {
      title: "List Weekly Missing Capability Insights",
      description:
        "Aggregate missing capabilities named in prospect declines into ranked insights for product/portfolio feedback. Read-only. Never sends anything (sent: false).",
      inputSchema: {
        since_days: z.number().int().min(1).max(365).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await listWeeklyMissingCapabilities(admin, tenantSlug, args.since_days ?? 30);
      return mcpToolResult(result);
    }
  );
}
