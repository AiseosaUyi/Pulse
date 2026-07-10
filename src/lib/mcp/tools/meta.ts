import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope, mcpToolResult, type ToolHandlerExtra } from "@/lib/api/mcp-context";
import { getTenantMeta } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
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
}
