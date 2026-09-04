import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import {
  listProspects,
  getProspect,
  upsertProspect,
  draftAndSaveDm,
  markDmSent,
  setProspectStatus,
  setProspectQuality,
  setProspectDuplicate,
  recordInboundMessage,
  addProspectNoteAdmin,
} from "@/lib/services/outbound";
import { getConversationThread, getOutreachToday } from "@/lib/services/outreach-intelligence";
import { listTemplates } from "@/lib/services/outbound-templates";
import { getOutboundFilters } from "@/lib/server/outbound-filters";
import { captureEventLead, KNOWN_EVENT_LEAD_PLATFORM_IDS } from "@/lib/services/event-leads";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { getTenantMeta } from "@/lib/services/tenants";
import { OUTBOUND_PLATFORMS, PROSPECT_STATUSES, PROSPECT_QUALITIES } from "@/lib/types/outbound";

export function registerSalesTools(server: McpServer) {
  server.registerTool(
    "pulse_list_prospects",
    {
      title: "List prospects",
      description:
        "List/filter the sales pipeline (status, platform, minimum qualification score, free-text search). Read-only, paginated.",
      inputSchema: {
        status: z.enum([...PROSPECT_STATUSES, "all"]).optional(),
        platform: z.enum(OUTBOUND_PLATFORMS).optional(),
        minScore: z.number().int().min(0).max(100).optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listProspects(admin, tenantSlug, {
        status: args.status,
        platform: args.platform,
        qualificationScoreMin: args.minScore,
        search: args.query,
        page: Math.floor(offset / limit),
        pageSize: limit,
      });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_get_prospect",
    {
      title: "Get prospect",
      description:
        "Single prospect plus its full conversation thread (outbound DMs, inbound messages, notes, AI conversation analyses) — everything needed for a tailored, non-spammy next move. Read-only.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const prospect = await getProspect(admin, tenantSlug, id);
      if (!prospect) return mcpToolError("Prospect not found");
      const thread = await getConversationThread(admin, tenantSlug, id);
      return mcpToolResult({ prospect, thread });
    }
  );

  server.registerTool(
    "pulse_upsert_prospect",
    {
      title: "Upsert prospect",
      description:
        "Create or update a prospect, deduplicated by (platform, handle) — or by externalAccountId when given, which is preferred: Instagram handles change, and a renamed account without externalAccountId creates a duplicate instead of updating. Mutates data.",
      inputSchema: {
        platform: z.enum(OUTBOUND_PLATFORMS),
        handle: z.string().min(1),
        externalAccountId: z.string().nullable().optional(),
        displayName: z.string().nullable().optional(),
        profileUrl: z.string().nullable().optional(),
        bio: z.string().nullable().optional(),
        followerCount: z.number().int().nullable().optional(),
        signalSummary: z.string().nullable().optional(),
        signalData: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await upsertProspect(admin, tenantSlug, args);
      if (!result) return mcpToolError("Upsert failed");
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_draft_dm",
    {
      title: "Draft an outbound DM",
      description:
        "AI-draft an outbound DM for a prospect in the brand voice and save it. `context` is the angle/reason to reach out now (e.g. \"they just posted about hosting an event in March\"). Mutates data — calls an LLM.",
      inputSchema: { id: z.string().uuid(), context: z.string().optional() },
    },
    async ({ id, context }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const tenant = await getTenantMeta(admin, tenantSlug);
      if (!tenant) return mcpToolError("Tenant not found");
      const { voice, positioning } = await getBrandContext(tenantSlug);
      const result = await draftAndSaveDm(admin, tenantSlug, id, {
        tenantName: tenant.name,
        voice,
        positioning,
        context,
      });
      if (!result) return mcpToolError("Prospect not found");
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_mark_dm_sent",
    {
      title: "Mark DM sent",
      description: "Mark a drafted DM as sent; cascades the prospect's pipeline stage to 'sent'. Mutates data.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await markDmSent(admin, tenantSlug, id);
      if (!result) return mcpToolError("DM not found");
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_list_followups",
    {
      title: "List follow-ups due",
      description:
        "Today's outreach queue: overdue, due today, new unread replies, and prospects going cold with no follow-up scheduled. Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      return mcpToolResult(await getOutreachToday(admin, tenantSlug));
    }
  );

  server.registerTool(
    "pulse_add_prospect_note",
    {
      title: "Add a prospect note",
      description: "Log a note / interaction on a prospect. Mutates data.",
      inputSchema: { id: z.string().uuid(), body: z.string().min(1) },
    },
    async ({ id, body }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;
      const result = await addProspectNoteAdmin(admin, tenantSlug, id, body, createdBy);
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_set_prospect_stage",
    {
      title: "Set prospect pipeline stage",
      description:
        "Transition a prospect's pipeline status (e.g. qualified → sent → replied → closed_won/closed_lost), with a reason — how to record 'went cold' or 're-engage'. Mutates data.",
      inputSchema: {
        id: z.string().uuid(),
        status: z.enum(PROSPECT_STATUSES),
        reason: z.string().optional(),
      },
    },
    async ({ id, status, reason }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await setProspectStatus(admin, tenantSlug, id, status, reason);
      if (!result.ok) return mcpToolError(result.error);
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_set_prospect_quality",
    {
      title: "Set prospect quality tier",
      description:
        "Set a prospect's quality/temperature tier (unscored/hot/warm/cold/dead) — a second dimension independent of pipeline `status`. Mutates data.",
      inputSchema: {
        id: z.string().uuid(),
        quality: z.enum(PROSPECT_QUALITIES),
      },
    },
    async ({ id, quality }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await setProspectQuality(admin, tenantSlug, id, quality);
      if (!result.ok) return mcpToolError(result.error);
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_mark_duplicate",
    {
      title: "Mark or unmark a prospect as a duplicate",
      description:
        "Mark a prospect as a duplicate of another (by its id), or unmark by passing duplicateOfId: null. Marking also drops the prospect's pipeline status to 'dismissed'. Never deletes a row. Mutates data.",
      inputSchema: {
        id: z.string().uuid(),
        duplicateOfId: z.string().uuid().nullable(),
      },
    },
    async ({ id, duplicateOfId }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await setProspectDuplicate(admin, tenantSlug, id, duplicateOfId);
      if (!result.ok) return mcpToolError(result.error);
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_record_inbound",
    {
      title: "Record an inbound reply",
      description:
        "Record an inbound reply text observed on-platform, so tone/intent can be analyzed and the next move decided. Mutates data.",
      inputSchema: {
        id: z.string().uuid(),
        body: z.string().min(1),
        inReplyToDmId: z.string().uuid().optional(),
      },
    },
    async ({ id, body, inReplyToDmId }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await recordInboundMessage(admin, tenantSlug, id, { body, inReplyToDmId });
      if (!result.ok) return mcpToolError(result.error);
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_capture_event_lead",
    {
      title: "Capture an event/organizer lead",
      description: `Capture an event/organizer lead from a known ticketing platform (${[...KNOWN_EVENT_LEAD_PLATFORM_IDS].join(", ")}). Mutates data.`,
      inputSchema: {
        platformId: z.string().refine((v) => KNOWN_EVENT_LEAD_PLATFORM_IDS.has(v)),
        pageUrl: z.string().min(1),
        eventTitle: z.string().nullable().optional(),
        organizerName: z.string().nullable().optional(),
        organizerHandle: z.string().nullable().optional(),
        priceRaw: z.string().nullable().optional(),
        socialUrl: z.string().nullable().optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await captureEventLead(admin, tenantSlug, { ...args, captureMethod: "mcp" });
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_outbound_filters",
    {
      title: "Get outbound discovery filters",
      description: "The tenant's outbound discovery filters (keywords, geo scope, competitors). Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:read");
      if (!gate.ok) return gate.error;
      const filters = await getOutboundFilters(gate.context.tenantSlug);
      return mcpToolResult({ filters, fetchedAt: new Date().toISOString() });
    }
  );

  server.registerTool(
    "pulse_outbound_templates",
    {
      title: "List outbound templates",
      description: "List outbound message templates (tenant-specific + global defaults). Read-only.",
      inputSchema: { status: z.enum(["active", "archived", "draft", "all"]).optional() },
    },
    async ({ status }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const templates = await listTemplates(admin, tenantSlug, { status });
      return mcpToolResult({ data: templates });
    }
  );
}
