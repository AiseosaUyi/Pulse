import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { listTemplates } from "@/lib/services/outbound-templates";
import type { TemplateStatus } from "@/lib/types/outbound-templates";

export const dynamic = "force-dynamic";

const METHODS = "GET";
const VALID_STATUSES = new Set<TemplateStatus | "all">(["active", "archived", "draft", "all"]);

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "sales:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get("status");
  if (statusRaw && !VALID_STATUSES.has(statusRaw as TemplateStatus | "all")) {
    return apiError(400, `Invalid status: ${statusRaw}`, headers);
  }

  const templates = await listTemplates(admin, tenantSlug, {
    status: (statusRaw as TemplateStatus | "all") ?? undefined,
  });
  return apiOk({ data: templates }, headers);
}
