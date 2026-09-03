// Comments + DMs needing a response. Shared with the pulse_inbox MCP
// tool via services/engagement.ts. POST is the write half — the missing
// endpoint that let an agent working the real platform in a browser put
// what it sees into Pulse. Shared with pulse_upsert_inbox_item via
// services/action-queue.ts.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk, apiPaginated, readPagination } from "@/lib/api/respond";
import { listInboxItems } from "@/lib/services/engagement";
import { upsertEngagementItem } from "@/lib/services/action-queue";

export const dynamic = "force-dynamic";

const METHODS = "GET, POST";
const PLATFORMS = new Set(["instagram", "tiktok", "twitter", "linkedin"]);

const upsertSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "twitter", "linkedin"]),
  type: z.enum(["dm", "comment", "mention", "reply"]),
  externalId: z.string().min(1),
  fromName: z.string().min(1),
  fromHandle: z.string().nullable().optional(),
  content: z.string().min(1),
  postTitle: z.string().nullable().optional(),
  externalUrl: z.string().nullable().optional(),
  receivedAt: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative", "question"]).nullable().optional(),
  priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
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
  const { limit, offset } = readPagination(searchParams);

  const platform = searchParams.get("platform");
  if (platform && !PLATFORMS.has(platform)) {
    return apiError(400, `Invalid platform: ${platform}`, headers);
  }
  const unansweredOnly = searchParams.get("unanswered") === "true";

  const { data, total } = await listInboxItems(admin, tenantSlug, {
    platform: platform ?? undefined,
    unansweredOnly,
    limit,
    offset,
  });

  const nextOffset = offset + data.length;
  const nextCursor = nextOffset < total ? String(nextOffset) : null;
  return apiPaginated(data, nextCursor, headers);
}

export async function POST(req: Request) {
  const ctx = await requireApiContext(req, "engage:write", METHODS);
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
  if (!parsed.success) return apiError(400, "Invalid body", headers, parsed.error.issues);

  const result = await upsertEngagementItem(admin, tenantSlug, parsed.data);
  if (!result.ok) return apiError(500, result.error, headers);
  return apiOk(result, headers);
}
