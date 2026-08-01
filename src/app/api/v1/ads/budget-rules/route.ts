import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { createAdBudgetRule, listAdBudgetRules } from "@/lib/services/ad-budget-rules";

export const dynamic = "force-dynamic";
const METHODS = "GET, POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "analytics:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug } = ctx.context;
  const headers = corsHeaders(METHODS);

  const rules = await listAdBudgetRules(tenantSlug);
  return apiOk({ data: rules }, headers);
}

const createSchema = z.object({
  adAccountId: z.string().uuid().optional(),
  name: z.string().min(1),
  scope: z.enum(["account", "campaign", "adset"]),
  targetExternalId: z.string().optional(),
  metric: z.enum(["cpa", "roas", "ctr", "frequency", "spend", "cpm"]),
  comparator: z.enum(["gt", "lt", "gte", "lte"]),
  threshold: z.number(),
  holdDays: z.number().int().min(1).max(14).optional(),
  action: z.enum(["pause", "notify_only", "increase_budget", "decrease_budget"]),
  actionAmountPct: z.number().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "publish:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, createdBy } = ctx.context;
  const headers = corsHeaders(METHODS);

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, parsed.error.issues[0]?.message ?? "Invalid body", headers);
  }

  const rule = await createAdBudgetRule({ tenantSlug, createdBy, ...parsed.data });
  return apiOk({ rule }, headers);
}
