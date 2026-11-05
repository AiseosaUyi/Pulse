import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { hasScope } from "@/lib/api/scopes";
import {
  requireToolScope,
  mcpToolError,
  mcpToolResult,
  type ToolHandlerExtra,
} from "@/lib/api/mcp-context";
import {
  listTasks,
  getOccurrencesForDate,
  createTask,
  updateTask,
  completeOccurrence,
  uncompleteOccurrence,
  excuseOccurrence,
  addTaskComment,
  recordPersonLeave,
  getStandupReport,
  getBreaches,
  getStreaksAndBreaches,
  getTenantTimezone,
  getTenantPeople,
} from "@/lib/services/tasks";
import { getTenantToday } from "@/lib/tasks/date-utils";

export function registerTasksTools(server: McpServer) {
  // 1. pulse_list_tasks
  server.registerTool(
    "pulse_list_tasks",
    {
      title: "List team tasks and habits",
      description:
        "List task definitions with owner, schedule, priority, tags and current streak count. Filterable by person, status (active/paused), kind (one_off/recurring), or tag. Read-only.",
      inputSchema: {
        person: z.string().optional().describe("Team person ID or name"),
        status: z.enum(["active", "paused", "archived"]).optional(),
        kind: z.enum(["one_off", "recurring"]).optional(),
        tag: z.string().optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;

      let personId: string | undefined;
      if (args.person) {
        const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
        const match = people.find(
          (p) => p.id === args.person || p.name.toLowerCase() === args.person?.toLowerCase()
        );
        if (!match) {
          return mcpToolError(`Team person "${args.person}" not found.`);
        }
        personId = match.id;
      }

      const tasks = await listTasks(admin, tenantSlug, {
        personId,
        status: args.status,
        kind: args.kind,
        tag: args.tag,
      });

      // Augment with current streaks
      const streakGroups = await getStreaksAndBreaches(admin, tenantSlug, { personId });
      const streakMap = new Map<string, number>();
      for (const g of streakGroups) {
        for (const t of g.tasks) {
          streakMap.set(t.task.id, t.currentStreak);
        }
      }

      const augmented = tasks.map((t) => ({
        ...t,
        currentStreak: streakMap.get(t.id) ?? 0,
      }));

      return mcpToolResult(augmented);
    }
  );

  // 2. pulse_tasks_today
  server.registerTool(
    "pulse_tasks_today",
    {
      title: "Get task occurrences for today or a specific date",
      description:
        "Get dated task occurrences for today (in the tenant's timezone) or a specified date, including checklist items, status, proof required and logged values. Read-only.",
      inputSchema: {
        person: z.string().optional().describe("Team person ID or name"),
        date: z.string().optional().describe("YYYY-MM-DD date (defaults to today in tenant timezone)"),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;

      const timezone = await getTenantTimezone(admin, tenantSlug);
      const targetDate = args.date ?? getTenantToday(timezone);

      let personId: string | undefined;
      if (args.person) {
        const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
        const match = people.find(
          (p) => p.id === args.person || p.name.toLowerCase() === args.person?.toLowerCase()
        );
        if (!match) {
          return mcpToolError(`Team person "${args.person}" not found.`);
        }
        personId = match.id;
      }

      const occurrences = await getOccurrencesForDate(admin, tenantSlug, targetDate, { personId });
      return mcpToolResult({ date: targetDate, occurrences });
    }
  );

  // 3. pulse_create_task
  server.registerTool(
    "pulse_create_task",
    {
      title: "Create a task or recurring habit",
      description:
        "Create a new one-off or recurring task with optional checklist template, proof requirement, and metrics. Automatically generates occurrences for upcoming days. Mutates data.",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        owner: z.string().min(1).describe("Team person ID or name"),
        priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
        kind: z.enum(["one_off", "recurring"]),
        startDate: z.string().describe("YYYY-MM-DD"),
        endDate: z.string().optional().describe("YYYY-MM-DD (optional, runs until stopped if omitted)"),
        dueDate: z.string().optional().describe("YYYY-MM-DD (for one_off tasks)"),
        dueTime: z.string().optional().describe("HH:mm or HH:mm:ss local tenant time"),
        recurrence: z.enum(["daily", "weekdays", "weekly", "monthly"]).optional(),
        recurrenceDays: z.array(z.number().min(1).max(7)).optional().describe("1=Mon .. 7=Sun for weekly"),
        recurrenceMonthDay: z.number().min(1).max(31).optional().describe("Day of month for monthly"),
        proofRequired: z.enum(["none", "link", "note", "image"]).optional(),
        proofHint: z.string().optional(),
        metricLabel: z.string().optional(),
        metricTarget: z.number().optional(),
        linkedType: z.enum(["prospect", "event", "post", "campaign"]).optional(),
        linkedId: z.string().optional(),
        tags: z.array(z.string()).optional(),
        checklist: z.array(z.string()).optional().describe("List of checklist items in position order"),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;

      // Resolve owner
      const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
      const match = people.find(
        (p) => p.id === args.owner || p.name.toLowerCase() === args.owner.toLowerCase()
      );
      if (!match) {
        return mcpToolError(`Team person "${args.owner}" not found. Available people: ${people.map((p) => p.name).join(", ")}`);
      }

      const creatorId = createdBy ?? match.userId;
      if (!creatorId) {
        return mcpToolError("A valid user context is required to create a task.");
      }

      try {
        const task = await createTask(
          admin,
          tenantSlug,
          {
            title: args.title,
            description: args.description,
            ownerPersonId: match.id,
            priority: args.priority,
            kind: args.kind,
            startDate: args.startDate,
            endDate: args.endDate,
            dueDate: args.dueDate,
            dueTime: args.dueTime,
            recurrence: args.recurrence,
            recurrenceDays: args.recurrenceDays,
            recurrenceMonthDay: args.recurrenceMonthDay,
            proofRequired: args.proofRequired,
            proofHint: args.proofHint,
            metricLabel: args.metricLabel,
            metricTarget: args.metricTarget,
            linkedType: args.linkedType,
            linkedId: args.linkedId,
            tags: args.tags,
            checklist: args.checklist,
          },
          creatorId
        );

        return mcpToolResult({ success: true, task });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to create task";
        return mcpToolError(message);
      }
    }
  );

  // 4. pulse_update_task
  server.registerTool(
    "pulse_update_task",
    {
      title: "Update task definition",
      description:
        "Update a task's title, schedule, owner, checklist or status. Changing fields applies to today's pending occurrence and the future only (history is preserved). Mutates data.",
      inputSchema: {
        id: z.string().uuid(),
        title: z.string().optional(),
        description: z.string().optional(),
        owner: z.string().optional().describe("Team person ID or name"),
        priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
        status: z.enum(["active", "paused", "archived"]).optional(),
        pausedUntil: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        dueDate: z.string().optional().describe("YYYY-MM-DD"),
        dueTime: z.string().optional(),
        recurrence: z.enum(["daily", "weekdays", "weekly", "monthly"]).optional(),
        recurrenceDays: z.array(z.number().min(1).max(7)).optional(),
        recurrenceMonthDay: z.number().min(1).max(31).optional(),
        proofRequired: z.enum(["none", "link", "note", "image"]).optional(),
        proofHint: z.string().optional(),
        metricLabel: z.string().optional(),
        metricTarget: z.number().optional(),
        tags: z.array(z.string()).optional(),
        checklist: z.array(z.string()).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;

      if (!createdBy) {
        return mcpToolError("A valid user context is required to update a task.");
      }

      let ownerPersonId: string | undefined;
      if (args.owner) {
        const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
        const match = people.find(
          (p) => p.id === args.owner || p.name.toLowerCase() === args.owner?.toLowerCase()
        );
        if (!match) return mcpToolError(`Team person "${args.owner}" not found.`);
        ownerPersonId = match.id;
      }

      try {
        const updated = await updateTask(
          admin,
          tenantSlug,
          args.id,
          {
            title: args.title,
            description: args.description,
            ownerPersonId,
            priority: args.priority,
            status: args.status,
            pausedUntil: args.pausedUntil,
            startDate: args.startDate,
            endDate: args.endDate,
            dueDate: args.dueDate,
            dueTime: args.dueTime,
            recurrence: args.recurrence,
            recurrenceDays: args.recurrenceDays,
            recurrenceMonthDay: args.recurrenceMonthDay,
            proofRequired: args.proofRequired,
            proofHint: args.proofHint,
            metricLabel: args.metricLabel,
            metricTarget: args.metricTarget,
            tags: args.tags,
            checklist: args.checklist,
          },
          createdBy
        );

        return mcpToolResult({ success: true, task: updated });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to update task";
        return mcpToolError(message);
      }
    }
  );

  // 5. pulse_complete_occurrence
  server.registerTool(
    "pulse_complete_occurrence",
    {
      title: "Mark a task occurrence as completed",
      description:
        "Complete a task occurrence. Enforces proof requirements (valid URL for link, note, etc.) and requires all checklist items to be checked. Refuses to complete another person's occurrence unless caller is admin or that person's lead. Mutates data.",
      inputSchema: {
        occurrenceId: z.string().uuid(),
        proofUrl: z.string().optional(),
        proofNote: z.string().optional(),
        proofImagePath: z.string().optional(),
        metricValue: z.number().optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;

      if (!createdBy) {
        return mcpToolError("A valid user context is required to complete an occurrence.");
      }

      const isAdmin = hasScope(gate.context.scopes, "admin");

      const result = await completeOccurrence(admin, tenantSlug, {
        occurrenceId: args.occurrenceId,
        completedBy: createdBy,
        isAdmin,
        proofUrl: args.proofUrl,
        proofNote: args.proofNote,
        proofImagePath: args.proofImagePath,
        metricValue: args.metricValue,
      });

      if (!result.ok) {
        return mcpToolError(result.error ?? "Failed to complete occurrence");
      }

      return mcpToolResult({ success: true, occurrenceId: args.occurrenceId });
    }
  );

  // 6. pulse_uncomplete_occurrence
  server.registerTool(
    "pulse_uncomplete_occurrence",
    {
      title: "Uncomplete a task occurrence",
      description: "Reverts a completed task occurrence back to pending. Mutates data.",
      inputSchema: {
        occurrenceId: z.string().uuid(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;

      if (!createdBy) {
        return mcpToolError("A valid user context is required to uncomplete an occurrence.");
      }

      const isAdmin = hasScope(gate.context.scopes, "admin");
      const result = await uncompleteOccurrence(admin, tenantSlug, args.occurrenceId, createdBy, isAdmin);

      if (!result.ok) {
        return mcpToolError(result.error ?? "Failed to uncomplete occurrence");
      }
      return mcpToolResult({ success: true });
    }
  );

  // 7. pulse_excuse_occurrence
  server.registerTool(
    "pulse_excuse_occurrence",
    {
      title: "Excuse a missed task occurrence",
      description: "Excuses a missed occurrence with a mandatory reason (Admin only). Mutates data.",
      inputSchema: {
        occurrenceId: z.string().uuid(),
        reason: z.string().min(1).describe("Reason for excusing the missed occurrence"),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;

      if (!createdBy) {
        return mcpToolError("A valid user context is required to excuse an occurrence.");
      }

      const result = await excuseOccurrence(admin, tenantSlug, args.occurrenceId, createdBy, args.reason);
      if (!result.ok) {
        return mcpToolError(result.error ?? "Failed to excuse occurrence");
      }
      return mcpToolResult({ success: true });
    }
  );

  // 8. pulse_add_task_comment
  server.registerTool(
    "pulse_add_task_comment",
    {
      title: "Add a comment to a task or occurrence",
      description: "Appends a comment to a task thread. Mutates data.",
      inputSchema: {
        taskId: z.string().uuid(),
        occurrenceId: z.string().uuid().optional(),
        body: z.string().min(1),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;

      if (!createdBy) {
        return mcpToolError("A valid user context is required to add a comment.");
      }

      try {
        const comment = await addTaskComment(admin, tenantSlug, {
          taskId: args.taskId,
          occurrenceId: args.occurrenceId,
          author: createdBy,
          body: args.body,
        });
        return mcpToolResult({ success: true, comment });
      } catch (err: unknown) {
        return mcpToolError(err instanceof Error ? err.message : "Failed to add comment");
      }
    }
  );

  // 9. pulse_record_leave
  server.registerTool(
    "pulse_record_leave",
    {
      title: "Record or request leave for a team member",
      description: "Records leave, automatically skipping scheduled occurrences for that period. Mutates data.",
      inputSchema: {
        person: z.string().describe("Team person ID or name"),
        startsOn: z.string().describe("YYYY-MM-DD"),
        endsOn: z.string().describe("YYYY-MM-DD"),
        reason: z.string().optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;

      if (!createdBy) {
        return mcpToolError("A valid user context is required to record leave.");
      }

      const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
      const match = people.find(
        (p) => p.id === args.person || p.name.toLowerCase() === args.person.toLowerCase()
      );
      if (!match) return mcpToolError(`Team person "${args.person}" not found.`);

      try {
        const leave = await recordPersonLeave(admin, tenantSlug, {
          personId: match.id,
          startsOn: args.startsOn,
          endsOn: args.endsOn,
          reason: args.reason,
          createdBy,
          status: "approved",
        });
        return mcpToolResult({ success: true, leave });
      } catch (err: unknown) {
        return mcpToolError(err instanceof Error ? err.message : "Failed to record leave");
      }
    }
  );

  // 10. pulse_list_people
  server.registerTool(
    "pulse_list_people",
    {
      title: "List tenant team people",
      description: "List all team people for the tenant with roles, tags, targets and active status. Read-only.",
      inputSchema: {
        activeOnly: z.boolean().optional().default(false),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;

      const people = await getTenantPeople(admin, tenantSlug, { activeOnly: args.activeOnly });
      return mcpToolResult(people);
    }
  );

  // 11. pulse_task_report
  server.registerTool(
    "pulse_task_report",
    {
      title: "Generate Friday standup report",
      description:
        "Generate team standup report for a date range (defaults to this week Monday to today) showing per-person completed tasks, recurring habit rates, metric totals, breaches and overdue tasks. Returns both structured JSON and plain-text WhatsApp formatted message. Read-only.",
      inputSchema: {
        from: z.string().describe("YYYY-MM-DD start date"),
        to: z.string().describe("YYYY-MM-DD end date"),
        person: z.string().optional().describe("Filter by person ID or name"),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;

      let personId: string | undefined;
      if (args.person) {
        const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
        const match = people.find(
          (p) => p.id === args.person || p.name.toLowerCase() === args.person?.toLowerCase()
        );
        if (!match) return mcpToolError(`Team person "${args.person}" not found.`);
        personId = match.id;
      }

      const report = await getStandupReport(admin, tenantSlug, args.from, args.to, personId);
      return mcpToolResult(report);
    }
  );

  // 12. pulse_task_breaches
  server.registerTool(
    "pulse_task_breaches",
    {
      title: "List missed occurrences (breaches)",
      description:
        "List all task occurrences automatically marked missed in a date range with owner, task title and date. Read-only.",
      inputSchema: {
        from: z.string().describe("YYYY-MM-DD start date"),
        to: z.string().describe("YYYY-MM-DD end date"),
        person: z.string().optional().describe("Filter by person ID or name"),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "tasks:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;

      let personId: string | undefined;
      if (args.person) {
        const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
        const match = people.find(
          (p) => p.id === args.person || p.name.toLowerCase() === args.person?.toLowerCase()
        );
        if (!match) return mcpToolError(`Team person "${args.person}" not found.`);
        personId = match.id;
      }

      const breaches = await getBreaches(admin, tenantSlug, args.from, args.to, personId);
      return mcpToolResult({ breaches });
    }
  );
}
