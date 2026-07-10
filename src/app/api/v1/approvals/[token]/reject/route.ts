// Reject a pending approval request. Same token-in-path auth model as
// ./approve/route.ts — see its header comment.

import { z } from "zod";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { checkPreAuthRateLimit } from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/api/context";
import { verifyApprovalToken } from "@/lib/approvals/token";
import { decideApproval } from "@/lib/services/approvals";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  reason: z.string().max(2000).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const headers = corsHeaders(METHODS);
  const preAuth = checkPreAuthRateLimit(getClientIp(req));
  if (!preAuth.ok) {
    return apiError(429, "Rate limit exceeded", { ...headers, "Retry-After": String(preAuth.retryAfterSeconds) });
  }

  const { token } = await ctx.params;
  const verified = await verifyApprovalToken(token);
  if (!verified.ok) {
    const status = verified.reason === "expired" ? 410 : 401;
    return apiError(status, verified.reason === "expired" ? "This link expired" : "Invalid link", headers);
  }

  let body: unknown = {};
  const raw = await req.text();
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError(400, "Invalid JSON body", headers);
    }
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return apiError(400, "Invalid body", headers, parsed.error.issues);

  const admin = createAdminClient();
  const result = await decideApproval(admin, verified.requestId, {
    action: "reject",
    rejectReason: parsed.data.reason,
  });
  if (!result.ok) return apiError(result.status, result.error, headers);

  return apiOk({ target: result.target }, headers);
}
