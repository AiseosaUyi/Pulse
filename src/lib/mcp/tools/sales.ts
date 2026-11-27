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
  setProspectOwner,
} from "@/lib/services/outbound";
import { getMyDay } from "@/lib/services/my-day";
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
        "Create or update a prospect, deduplicated by (platform, handle) or externalAccountId. Checks outreach ledger for exclusions first. Server-side verifies email evidence before storing email. Mutates data. Never sends any messages (sent: false).",
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
        email: z.string().nullable().optional(),
        email_source_url: z.string().nullable().optional(),
        emailSourceUrl: z.string().nullable().optional(),
        evidence_url: z.string().nullable().optional(),
        evidenceUrl: z.string().nullable().optional(),
        evidence: z.string().nullable().optional(),
        evidence_date: z.string().nullable().optional(),
        evidenceDate: z.string().nullable().optional(),
        segment: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Lead type, e.g. the kind of business this is. Must be one of this workspace's lead types (set in Settings > Outreach autopilot); it picks which proof/offer/ask lines drafts use. Unknown values fall back to the default lead type and the result carries lead_type_warning listing the valid ones."
          ),
        country: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        team_size: z.string().nullable().optional(),
        teamSize: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        company_name: z.string().nullable().optional(),
        companyName: z.string().nullable().optional(),
        flags: z.array(z.string()).optional(),
        run_id: z.string().nullable().optional(),
        runId: z.string().nullable().optional(),
        ignore_ledger: z.boolean().optional(),
        ignoreLedger: z.boolean().optional(),
        phone: z.string().nullable().optional(),
        channel_handoff: z.enum(["whatsapp", "phone", "email", "none"]).optional(),
        channelHandoff: z.enum(["whatsapp", "phone", "email", "none"]).optional(),
        handoff_contact: z.string().nullable().optional(),
        handoffContact: z.string().nullable().optional(),
        handoff_at: z.string().nullable().optional(),
        handoffAt: z.string().nullable().optional(),
        email_verified: z.boolean().optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await upsertProspect(admin, tenantSlug, {
        platform: args.platform,
        handle: args.handle,
        externalAccountId: args.externalAccountId,
        displayName: args.displayName,
        profileUrl: args.profileUrl,
        bio: args.bio,
        followerCount: args.followerCount,
        signalSummary: args.signalSummary,
        signalData: args.signalData,
        email: args.email,
        emailSourceUrl: args.emailSourceUrl ?? args.email_source_url,
        evidenceUrl: args.evidenceUrl ?? args.evidence_url,
        evidence: args.evidence,
        evidenceDate: args.evidenceDate ?? args.evidence_date,
        segment: args.segment,
        country: args.country,
        city: args.city,
        teamSize: args.teamSize ?? args.team_size,
        website: args.website,
        companyName: args.companyName ?? args.company_name,
        flags: args.flags,
        runId: args.runId ?? args.run_id,
        ignoreLedger: args.ignoreLedger ?? args.ignore_ledger,
        phone: args.phone,
        channelHandoff: args.channelHandoff ?? args.channel_handoff,
        handoffContact: args.handoffContact ?? args.handoff_contact,
        handoffAt: args.handoffAt ?? args.handoff_at,
        email_verified: args.email_verified,
      });
      if (!result) return mcpToolError("Upsert failed");
      return mcpToolResult({ ...result, sent: false });
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

  server.registerTool(
    "pulse_my_day",
    {
      title: "Get My Day work list",
      description:
        "Daily personal work list across 5 sections: reply now, ready to send, follow up today, find contact, and weekly scoreboard. Scoped to current tenant. Read-only.",
      inputSchema: {
        owner: z
          .string()
          .optional()
          .describe("Team member name or ID to filter by, or 'all'/'everyone'."),
      },
    },
    async ({ owner }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const data = await getMyDay(admin, tenantSlug, { owner });
      return mcpToolResult(data);
    }
  );

  server.registerTool(
    "pulse_set_prospect_owner",
    {
      title: "Set prospect owner",
      description: "Assign or reassign a prospect to a team member (or null to unassign). Protected by sales:write.",
      inputSchema: {
        prospectId: z.string().uuid().describe("The prospect's ID"),
        owner: z.string().nullable().describe("Team member name, team person ID, or null to unassign"),
      },
    },
    async ({ prospectId, owner }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "sales:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await setProspectOwner(admin, tenantSlug, prospectId, owner);
      if (!result.ok) return mcpToolError(result.error);
      return mcpToolResult({ ok: true, prospect: result.prospect });
    }
  );
}
