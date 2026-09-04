import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk, apiPaginated, readPagination } from "@/lib/api/respond";
import { listProspects, upsertProspect } from "@/lib/services/outbound";
import {
  OUTBOUND_PLATFORMS,
  PROSPECT_STATUSES,
  type OutboundPlatform,
  type ProspectStatus,
} from "@/lib/types/outbound";

export const dynamic = "force-dynamic";

const METHODS = "GET, POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

function isProspectStatus(v: string): v is ProspectStatus {
  return (PROSPECT_STATUSES as readonly string[]).includes(v);
}

function isOutboundPlatform(v: string): v is OutboundPlatform {
  return (OUTBOUND_PLATFORMS as readonly string[]).includes(v);
}

export async function GET(req: Request) {
  const ctx = await requireApiContext(req, "sales:read", METHODS);
  if (!ctx.ok) return ctx.response;
  const { tenantSlug, admin } = ctx.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const { limit, offset } = readPagination(searchParams);

  const statusRaw = searchParams.get("status");
  if (statusRaw && statusRaw !== "all" && !isProspectStatus(statusRaw)) {
    return apiError(400, `Invalid status: ${statusRaw}`, headers);
  }

  const platformRaw = searchParams.get("platform");
  if (platformRaw && !isOutboundPlatform(platformRaw)) {
    return apiError(400, `Invalid platform: ${platformRaw}`, headers);
  }

  const scoreMinRaw = searchParams.get("qualificationScoreMin");
  let qualificationScoreMin: number | undefined;
  if (scoreMinRaw !== null) {
    qualificationScoreMin = Number(scoreMinRaw);
    if (!Number.isFinite(qualificationScoreMin) || qualificationScoreMin < 0 || qualificationScoreMin > 100) {
      return apiError(400, "qualificationScoreMin must be a number 0-100", headers);
    }
  }

  const page = Math.floor(offset / limit);
  const { data, total } = await listProspects(admin, tenantSlug, {
    status: (statusRaw ?? undefined) as ProspectStatus | "all" | undefined,
    platform: (platformRaw ?? undefined) as OutboundPlatform | undefined,
    qualificationScoreMin,
    search: searchParams.get("search") ?? undefined,
    page,
    pageSize: limit,
  });

  const nextOffset = offset + data.length;
  const nextCursor = nextOffset < total ? String(nextOffset) : null;
  return apiPaginated(data, nextCursor, headers);
}

const upsertSchema = z.object({
  platform: z.enum(OUTBOUND_PLATFORMS),
  handle: z.string().min(1),
  externalAccountId: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  profileUrl: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  followerCount: z.number().int().nullable().optional(),
  signalSummary: z.string().nullable().optional(),
  signalData: z.record(z.string(), z.unknown()).optional(),
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
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Invalid body", headers, parsed.error.issues);
  }

  const result = await upsertProspect(admin, tenantSlug, parsed.data);
  if (!result) {
    return apiError(500, "Upsert failed", headers);
  }
  return apiOk(result, headers);
}
