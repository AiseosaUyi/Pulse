import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolError, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { getTenantMeta } from "@/lib/services/tenants";
import { getBrandContext, setBrandPositioning } from "@/lib/ai/brand-positioning";
import { setBrandVoice } from "@/lib/ai/brand-voice";
import { API_V1_MANIFEST } from "@/lib/api/manifest";

export function registerMetaTools(server: McpServer) {
  server.registerTool(
    "pulse_whoami",
    {
      title: "Who am I",
      description:
        "Resolve the connected token to its tenant, brand voice/positioning, and granted scopes. Call this first to ground yourself before anything else — read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, null);
      if (!gate.ok) return gate.error;
      const { tenantSlug, scopes, admin } = gate.context;

      const [tenant, brand] = await Promise.all([
        getTenantMeta(admin, tenantSlug),
        getBrandContext(tenantSlug),
      ]);
      if (!tenant) return mcpToolResult({ error: "Tenant not found" });

      return mcpToolResult({
        tenant,
        brandVoice: brand.voice,
        positioning: brand.positioning,
        scopes,
      });
    }
  );

  server.registerTool(
    "pulse_manifest",
    {
      title: "List capabilities",
      description:
        "Machine-readable list of every Pulse REST endpoint (which every MCP tool here mirrors 1:1) — method, path, required scope, description. Use this to discover new capabilities without needing a code update. Read-only.",
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, null);
      if (!gate.ok) return gate.error;
      return mcpToolResult({ version: "v1", endpoints: API_V1_MANIFEST });
    }
  );

  server.registerTool(
    "pulse_update_brand_voice",
    {
      title: "Write brand voice and/or positioning",
      description:
        "Write the tenant's brand voice and/or positioning (at least one required) — the config every AI draft/DM/analysis reads. Mutates data. An unauthored/placeholder brand voice means every reply draft is generic copy wearing the tenant's name.",
      inputSchema: {
        brandVoice: z.record(z.string(), z.unknown()).optional(),
        positioning: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args, extra: ToolHandlerExtra) => {
      const gate = requireToolScope(extra, "admin");
      if (!gate.ok) return gate.error;
      const { tenantSlug, admin } = gate.context;

      if (args.brandVoice === undefined && args.positioning === undefined) {
        return mcpToolError("At least one of brandVoice or positioning is required");
      }
      if (args.brandVoice !== undefined) {
        const result = await setBrandVoice(admin, tenantSlug, args.brandVoice);
        if (!result.ok) return mcpToolError(result.error);
      }
      if (args.positioning !== undefined) {
        const result = await setBrandPositioning(admin, tenantSlug, args.positioning);
        if (!result.ok) return mcpToolError(result.error);
      }

      const brand = await getBrandContext(tenantSlug);
      return mcpToolResult({ brandVoice: brand.voice, positioning: brand.positioning });
    }
  );
}
