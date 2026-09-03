// The Action Queue as MCP tools — mirrors /api/v1/action-queue,
// /api/v1/inbox, /api/v1/action-items, /api/v1/agent-runs 1:1. Tool
// descriptions are blunt about which ones mutate, since the agent reads
// them to decide what's safe to call unattended.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import {
  listActionQueue,
  upsertEngagementItem,
  upsertActionItem,
  setProposedReply,
  setQueueStatus,
  assignQueueRow,
  startAgentRun,
  finishAgentRun,
  type RowRef,
} from "@/lib/services/action-queue";

const KINDS = ["reply", "follow_up", "decision", "escalation", "opportunity", "chore"] as const;
const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
const STATUSES = ["open", "snoozed", "resolved", "dismissed"] as const;
const SOURCES = ["engagement", "action", "coach", "prospect"] as const;
const PLATFORMS = ["instagram", "tiktok", "twitter", "linkedin"] as const;
const TYPES = ["dm", "comment", "mention", "reply"] as const;

export function registerActionQueueTools(server: McpServer) {
  server.registerTool(
    "pulse_action_queue",
    {
      title: "The unified attention board",
      description:
        "Everything needing attention on the social accounts, grouped: needs a reply, needs a decision, follow-ups due, going cold, opportunities. Read-only, filterable.",
      inputSchema: {
        status: z.enum(STATUSES).optional(),
        kind: z.enum(KINDS).optional(),
        priority: z.enum(PRIORITIES).optional(),
        assignedTo: z.string().optional(),
        platform: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await listActionQueue(admin, tenantSlug, args);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_upsert_inbox_item",
    {
      title: "Put an observed comment/DM into the inbox",
      description:
        "Upsert a comment or DM you observed on the real platform, deduplicated by (platform, externalId) — calling this twice for the same item updates it, never duplicates. This is the write path that lets you put what you see into Pulse. Mutates data.",
      inputSchema: {
        platform: z.enum(PLATFORMS),
        type: z.enum(TYPES),
        externalId: z.string().min(1),
        fromName: z.string().min(1),
        fromHandle: z.string().nullable().optional(),
        content: z.string().min(1),
        postTitle: z.string().nullable().optional(),
        externalUrl: z.string().nullable().optional(),
        receivedAt: z.string(),
        sentiment: z.enum(["positive", "neutral", "negative", "question"]).nullable().optional(),
        priority: z.enum(PRIORITIES).optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await upsertEngagementItem(admin, tenantSlug, args);
      if (!result.ok) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_set_proposed_reply",
    {
      title: "Save a proposed reply",
      description:
        "Save agent- or human-authored reply text on a queue row without sending it — a human reviews/edits it in the UI. Mutates data.",
      inputSchema: {
        source: z.enum(SOURCES),
        id: z.string(),
        text: z.string().min(1),
        author: z.enum(["agent", "human", "ai_generated"]),
      },
    },
    async ({ source, id, text, author }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const rowRef: RowRef = { source, id };
      const result = await setProposedReply(admin, tenantSlug, rowRef, { text, author });
      if (!result.ok) return mcpToolError(result.error ?? "Row not found");
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_set_queue_status",
    {
      title: "Resolve / snooze / dismiss a queue row",
      description:
        "Set a queue row's status. Resolving a comment/DM also marks it replied, so it stops showing up as unanswered. Mutates data.",
      inputSchema: {
        source: z.enum(SOURCES),
        id: z.string(),
        status: z.enum(STATUSES),
        resolutionNote: z.string().optional(),
        snoozedUntil: z.string().optional(),
      },
    },
    async ({ source, id, status, resolutionNote, snoozedUntil }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;
      const rowRef: RowRef = { source, id };
      const result = await setQueueStatus(admin, tenantSlug, rowRef, {
        status,
        resolutionNote,
        snoozedUntil,
        resolvedBy: createdBy ?? undefined,
      });
      if (!result.ok) return mcpToolError(result.error ?? "Row not found");
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_assign_queue_row",
    {
      title: "Assign a queue row",
      description: "Assign (or unassign, pass null) a queue row to a team member by user id. Mutates data.",
      inputSchema: {
        source: z.enum(SOURCES),
        id: z.string(),
        assignedTo: z.string().nullable(),
      },
    },
    async ({ source, id, assignedTo }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const rowRef: RowRef = { source, id };
      const result = await assignQueueRow(admin, tenantSlug, rowRef, assignedTo);
      if (!result.ok) return mcpToolError(result.error ?? "Row not found");
      return mcpToolResult({ success: true });
    }
  );

  server.registerTool(
    "pulse_upsert_action_item",
    {
      title: "Put a non-message attention item on the board",
      description:
        "Upsert something that needs attention but isn't a comment/DM — a pending invite, a decision, an escalation, an opportunity, a chore. Deduplicated by dedupeKey, so re-running a daily sweep updates the existing row instead of creating a new one every day. Mutates data.",
      inputSchema: {
        kind: z.enum(KINDS),
        title: z.string().min(1),
        body: z.string().nullable().optional(),
        why: z.string().nullable().optional(),
        priority: z.enum(PRIORITIES).optional(),
        platform: z.string().nullable().optional(),
        externalUrl: z.string().nullable().optional(),
        actionLabel: z.string().nullable().optional(),
        proposedReply: z.string().nullable().optional(),
        dedupeKey: z.string().min(1),
        prospectId: z.string().nullable().optional(),
        dueAt: z.string().nullable().optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await upsertActionItem(admin, tenantSlug, args);
      if (!result.ok) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_start_run",
    {
      title: "Open an agent run",
      description:
        "Log the start of a daily/periodic run (e.g. 'agent-social' working Instagram) so 'new since the last run' is answerable later. Returns a runId to pass to pulse_finish_run. Mutates data.",
      inputSchema: {
        agent: z.string().min(1),
        surface: z.string().optional(),
      },
    },
    async ({ agent, surface }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await startAgentRun(admin, tenantSlug, { agent, surface });
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_finish_run",
    {
      title: "Close an agent run",
      description: "Close a run opened with pulse_start_run, with a summary of what happened. Mutates data.",
      inputSchema: {
        runId: z.string(),
        summary: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ runId, summary }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "engage:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await finishAgentRun(admin, tenantSlug, runId, summary ?? {});
      if (!result.ok) return mcpToolError("Run not found");
      return mcpToolResult({ success: true });
    }
  );
}
