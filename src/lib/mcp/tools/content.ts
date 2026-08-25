import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { listBriefsApi, generateAndSaveBrief } from "@/lib/services/briefs";
import { listContentSlotsApi } from "@/lib/services/content-calendar";
import { rolloverOverdueSlots, retireStaleSlots } from "@/lib/services/content-calendar-lifecycle";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";
import { listBlogPostsApi, getBlogPostRecordApi, createManualBlogPostApi } from "@/lib/services/blog-posts";
import { listBlogPostVersionsApi } from "@/lib/services/blog-versions";
import { composeAndSaveApi } from "@/lib/services/social-drafts";
import { composeModes } from "@/lib/ai/compose-take";
import { captureSpaceInputSchema, createSpaceCaptureApi, completeSpaceCaptureApi } from "@/lib/services/spaces";

const BRIEF_STATUSES = ["draft", "approved", "published", "dismissed"] as const;
const BLOG_STATUSES = ["draft", "editing", "review", "published", "archived"] as const;

export function registerContentTools(server: McpServer) {
  server.registerTool(
    "pulse_list_briefs",
    {
      title: "List content briefs",
      description: "List content briefs generated from competitor intel signals, filterable by status. Read-only, paginated.",
      inputSchema: {
        status: z.enum(BRIEF_STATUSES).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listBriefsApi(admin, tenantSlug, { status: args.status, limit, offset });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_generate_brief",
    {
      title: "Generate a content brief",
      description:
        "AI-generate a content brief (title, outline, draft, SEO keywords) from an existing intel card and save it. Requires a real intel_cards id — not a free-text topic. Mutates data — calls an LLM.",
      inputSchema: { cardId: z.string().min(1) },
    },
    async ({ cardId }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await generateAndSaveBrief(admin, tenantSlug, cardId);
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_content_calendar",
    {
      title: "Get the content calendar queue",
      description:
        "Upcoming content_slots for the tenant (individual-persona feature — allowlist-gated, same as the app). Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      if (!isContentCalendarEnabledForTenant(tenantSlug)) {
        return mcpToolError("Content calendar not enabled for this tenant");
      }
      await retireStaleSlots(admin, tenantSlug);
      await rolloverOverdueSlots(admin, tenantSlug);
      const slots = await listContentSlotsApi(admin, tenantSlug);
      return mcpToolResult(slots);
    }
  );

  server.registerTool(
    "pulse_list_blog_posts",
    {
      title: "List blog posts",
      description: "List blog posts, filterable by status. Read-only, paginated.",
      inputSchema: {
        status: z.enum(BLOG_STATUSES).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().min(0).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const limit = args.limit ?? 25;
      const offset = args.cursor ?? 0;
      const { data, total } = await listBlogPostsApi(admin, tenantSlug, { status: args.status, limit, offset });
      const nextOffset = offset + data.length;
      return mcpToolResult({ data, nextCursor: nextOffset < total ? nextOffset : null });
    }
  );

  server.registerTool(
    "pulse_get_blog_post",
    {
      title: "Get a blog post",
      description: "Single blog post plus its latest saved version. Read-only.",
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:read");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const post = await getBlogPostRecordApi(admin, tenantSlug, id);
      if (!post) return mcpToolError("Blog post not found");
      const [latestVersion] = await listBlogPostVersionsApi(admin, tenantSlug, id, 1);
      return mcpToolResult({ post, latestVersion: latestVersion ?? null });
    }
  );

  server.registerTool(
    "pulse_create_blog_post",
    {
      title: "Create a draft blog post",
      description:
        "AI-write a draft blog post from a title, target keyword, and/or free-text context — at least one is required. Mutates data — calls an LLM (multi-pass, not cheap).",
      inputSchema: {
        title: z.string().min(1).optional(),
        improveTitle: z.boolean().optional(),
        targetKeyword: z.string().min(1).optional(),
        extraContext: z.string().min(1).optional(),
        targetWordCount: z.number().int().min(200).max(5000).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await createManualBlogPostApi(admin, tenantSlug, args);
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_compose_caption",
    {
      title: "Compose a multi-platform caption",
      description:
        "AI-compose platform-native caption variants (X, LinkedIn, Instagram, TikTok, YouTube) from a source URL or a free-text angle, in the brand voice, and save the draft. Mutates data — calls an LLM.",
      inputSchema: {
        mode: z.enum(composeModes),
        sourceUrl: z.string().min(1).optional(),
        angle: z.string().min(1).max(2000).optional(),
        focusPlatforms: z.array(z.string()).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;
      const result = await composeAndSaveApi(admin, tenantSlug, createdBy, args);
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_capture_space",
    {
      title: "Start an X Space capture",
      description:
        "Start capturing an X/Twitter Space's audio: creates a saved_content row and returns an R2 presigned upload URL to PUT the finished mp3 to. Extraction itself happens outside Pulse — it needs a logged-in X session and a long-running download, see scripts/space-capture/download_space.sh — this tool only registers the capture and hands back where to send the bytes. Follow up with pulse_complete_space once the PUT succeeds. Mutates data.",
      inputSchema: {
        spaceUrl: z.string().min(1),
        title: z.string().min(1).max(300).nullable().optional(),
        hostHandle: z.string().min(1).max(100).nullable().optional(),
        durationS: z.number().int().positive().nullable().optional(),
        transcript: z.string().nullable().optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin, createdBy } = gate.context;
      const parsed = captureSpaceInputSchema.safeParse(args);
      if (!parsed.success) {
        return mcpToolError(parsed.error.issues.map((i) => i.message).join("; "));
      }
      const result = await createSpaceCaptureApi(admin, tenantSlug, createdBy, parsed.data);
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );

  server.registerTool(
    "pulse_complete_space",
    {
      title: "Mark an X Space capture extracted",
      description:
        "Mark an X Space capture as extracted once the mp3 has been PUT to the presigned upload URL returned by pulse_capture_space. Errors if no file is found at the expected storage location yet. Mutates data.",
      inputSchema: { captureId: z.string().uuid() },
    },
    async ({ captureId }, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "content:write");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;
      const result = await completeSpaceCaptureApi(admin, tenantSlug, captureId);
      if ("error" in result) return mcpToolError(result.error);
      return mcpToolResult(result);
    }
  );
}
