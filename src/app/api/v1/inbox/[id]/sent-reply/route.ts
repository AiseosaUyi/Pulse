// Records what was actually sent for a reply posted outside Pulse (e.g.
// through the browser) — the column existed and three in-app paths write
// it, but no MCP/API path did, so a reply posted through the browser left
// no record of its wording. Shared with pulse_record_sent_reply via
// services/action-queue.ts.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { recordSentReply } from "@/lib/services/action-queue";

export const dynamic = "force-dynamic";

const METHODS = "POST";

const sentReplySchema = z.object({
  sentBody: z.string().min(1),
});

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const apiCtx = await requireApiContext(req, "engage:write", METHODS);
  if (!apiCtx.ok) return apiCtx.response;
  const { tenantSlug, admin } = apiCtx.context;
  const headers = corsHeaders(METHODS);
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body", headers);
  }
  const parsed = sentReplySchema.safeParse(body);
  if (!parsed.success) return apiError(400, "Invalid body", headers, parsed.error.issues);

  // approvedBy omitted — a bearer-token/MCP caller has no user session, so
  // this is always agent-authored (approved_by IS NULL is the existing
  // AI-vs-human signal; see recordSentReply's own doc comment).
  const result = await recordSentReply(admin, tenantSlug, { source: "engagement", id }, { sentBody: parsed.data.sentBody });
  if (!result.ok) return apiError(result.status, result.error ?? "Update failed", headers);
  return apiOk({ success: true }, headers);
}
