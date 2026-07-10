// Capture an event/organizer lead from a known ticketing platform.
// Wraps the same captureEventLead() service /api/ext/event-lead uses.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { captureEventLead, KNOWN_EVENT_LEAD_PLATFORM_IDS } from "@/lib/services/event-leads";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  platformId: z.string().refine((v) => KNOWN_EVENT_LEAD_PLATFORM_IDS.has(v), {
    message: "platformId must be a known event platform",
  }),
  pageUrl: z.string().min(1),
  eventTitle: z.string().nullable().optional(),
  organizerName: z.string().nullable().optional(),
  organizerHandle: z.string().nullable().optional(),
  priceRaw: z.string().nullable().optional(),
  socialUrl: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "sales:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const result = await captureEventLead(admin, tenantSlug, {
    ...parsed.data,
    captureMethod: "api",
  });
  if ("error" in result) {
    return apiError(500, result.error, headers);
  }
  return apiOk(result, headers);
}
