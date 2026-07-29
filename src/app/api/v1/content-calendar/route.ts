// Individual-persona feature — allowlist-gated the same way the app is
// (isContentCalendarEnabledForTenant), not just persona-gated. A token
// minted for a non-allowlisted tenant gets a 404, same as the page would.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { listContentSlotsApi, generateNextBatchApi } from "@/lib/services/content-calendar";
import { rolloverOverdueSlots, retireStaleSlots } from "@/lib/services/content-calendar-lifecycle";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";

export const dynamic = "force-dynamic";
// Batch generation is sequential per slot (each pick needs to see every
// earlier pick — see generateNextBatchApi) across up to MAX_ROUNDS
// self-correcting rounds, plus concurrent briefing calls — real measured
// latency for a 10-slot batch runs well past the default 15s/60s function
// timeout. Mirrors the same maxDuration already set on the /content-calendar
// page route for the identical underlying generation call.
export const maxDuration = 300;

const METHODS = "GET, POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "content:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  if (!isContentCalendarEnabledForTenant(tenantSlug)) {
    return apiError(404, "Content calendar not enabled for this tenant", headers);
  }

  await retireStaleSlots(admin, tenantSlug);
  await rolloverOverdueSlots(admin, tenantSlug);

  const slots = await listContentSlotsApi(admin, tenantSlug);
  return apiOk(slots, headers);
}

const generateBodySchema = z.object({
  batchSize: z.number().int().min(1).max(10).default(10),
  instruction: z.string().min(1).max(2000).optional(),
});

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "content:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin, createdBy } = ctx.context;
  const headers = corsHeaders(METHODS);

  console.log(`[content-calendar-api] POST start — tenant=${tenantSlug}`);

  if (!isContentCalendarEnabledForTenant(tenantSlug)) {
    console.warn(`[content-calendar-api] POST rejected — content calendar not enabled — tenant=${tenantSlug}`);
    return apiError(404, "Content calendar not enabled for this tenant", headers);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    console.error(`[content-calendar-api] POST failed — invalid JSON body — tenant=${tenantSlug}`);
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = generateBodySchema.safeParse(body);
  if (!parsed.success) {
    console.error(`[content-calendar-api] POST failed — invalid body — tenant=${tenantSlug}`, parsed.error.issues);
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }
  const { batchSize, instruction } = parsed.data;

  try {
    const result = await generateNextBatchApi(admin, tenantSlug, createdBy, batchSize, instruction);
    if (!result.success) {
      console.error(`[content-calendar-api] POST failed — tenant=${tenantSlug} error=${result.error}`);
      return apiError(400, result.error, headers);
    }

    console.log(
      `[content-calendar-api] POST success — tenant=${tenantSlug} generated=${result.generated} errors=${result.errors} roundsUsed=${result.roundsUsed} missingPillars=[${result.missingPillars.join(", ")}]`
    );
    return apiOk(result, headers);
  } catch (err) {
    console.error(`[content-calendar-api] POST threw — tenant=${tenantSlug}`, err);
    return apiError(500, err instanceof Error ? err.message : "Generation failed", headers);
  }
}
