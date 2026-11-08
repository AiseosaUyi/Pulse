// Conversation handoff endpoints (e.g. "moved to WhatsApp").
// Handoffs live at thread level. POST upserts active handoff,
// DELETE clears it, GET returns the active handoff if any.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import {
  markHandoff,
  clearHandoff,
  getActiveHandoff,
} from "@/lib/services/handoff";

export const dynamic = "force-dynamic";

const METHODS = "GET, POST, DELETE";
const PLATFORMS = ["instagram", "tiktok", "twitter", "linkedin"] as const;
const CHANNELS = ["whatsapp", "phone", "email", "in_person", "other"] as const;

const postSchema = z.object({
  platform: z.enum(PLATFORMS),
  threadExternalId: z.string().min(1),
  channel: z.enum(CHANNELS).or(z.string().min(1)),
  contact: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  movedBy: z.string().optional(),
});

const deleteSchema = z.object({
  platform: z.enum(PLATFORMS),
  threadExternalId: z.string().min(1),
});

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "engage:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const platform = searchParams.get("platform");
  const threadExternalId = searchParams.get("threadExternalId");

  if (!platform || !threadExternalId) {
    return apiError(400, "platform and threadExternalId query parameters are required", headers);
  }

  const handoff = await getActiveHandoff(admin, tenantSlug, platform, threadExternalId);
  return apiOk({ handoff }, headers);
}

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "engage:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin, createdBy } = ctx.context;
  const headers = corsHeaders(METHODS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const result = await markHandoff(admin, tenantSlug, {
    ...parsed.data,
    movedBy: parsed.data.movedBy ?? createdBy ?? null,
  });

  if (!result.ok) {
    return apiError(400, result.error, headers);
  }

  return apiOk(result, headers);
}

export async function DELETE(req: Request) {
  const ctx = await requireApiContext(req, "engage:write", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin, createdBy } = ctx.context;
  const headers = corsHeaders(METHODS);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const result = await clearHandoff(admin, tenantSlug, {
    platform: parsed.data.platform,
    threadExternalId: parsed.data.threadExternalId,
    clearedBy: createdBy ?? null,
  });

  if (!result.ok) {
    return apiError(400, result.error, headers);
  }

  return apiOk({ success: true, cleared: true }, headers);
}
