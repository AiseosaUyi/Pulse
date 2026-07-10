// Send a scheduled_post or content_brief for human approval, over email or
// WhatsApp. Scope depends on the target: scheduled_post needs publish:write
// (it's a step in the publish pipeline), content_brief needs content:write.

import { z } from "zod";
import { requireApiContext } from "@/lib/api/context";
import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { createApprovalRequest, getApprovalContext } from "@/lib/services/approvals";
import { deliverApprovalLink } from "@/lib/approvals/deliver";
import { isApprovalsConfigured } from "@/lib/approvals/token";
import { hasScope } from "@/lib/api/scopes";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import { checkPreAuthRateLimit, checkRateLimit } from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/api/context";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

const bodySchema = z.object({
  targetType: z.enum(["scheduled_post", "content_brief"]),
  targetId: z.string().uuid(),
  deliveredVia: z.enum(["email", "whatsapp"]),
  deliveredTo: z.string().min(1),
});

export async function POST(req: Request) {
  const headers = corsHeaders(METHODS);

  // Manual auth (not requireApiContext) because the required scope depends
  // on the request body's targetType, which requireApiContext's signature
  // doesn't support checking mid-flight — same rate-limit + resolve steps,
  // just a scope check that runs after the body is parsed.
  const preAuth = checkPreAuthRateLimit(getClientIp(req));
  if (!preAuth.ok) {
    return apiError(429, "Rate limit exceeded", { ...headers, "Retry-After": String(preAuth.retryAfterSeconds) });
  }
  const bearer = extractBearer(req);
  const resolved = bearer ? await resolveApiToken(bearer) : null;
  if (!resolved) return apiError(401, "Unauthorized", headers);
  const rl = checkRateLimit(resolved.tokenId);
  if (!rl.ok) {
    return apiError(429, "Rate limit exceeded", { ...headers, "Retry-After": String(rl.retryAfterSeconds) });
  }

  if (!isApprovalsConfigured()) {
    return apiError(503, "Approval links aren't configured (APPROVAL_TOKEN_SECRET unset)", headers);
  }

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

  const requiredScope = parsed.data.targetType === "scheduled_post" ? "publish:write" : "content:write";
  if (!hasScope(resolved.scopes, requiredScope)) {
    return apiError(403, `Missing required scope: ${requiredScope}`, headers);
  }

  const admin = createAdminClient();
  const minted = await createApprovalRequest(admin, resolved.tenantSlug, {
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    deliveredVia: parsed.data.deliveredVia,
    deliveredTo: parsed.data.deliveredTo,
    createdBy: resolved.createdBy,
  });
  if ("error" in minted) return apiError(404, minted.error, headers);

  const ctx = await getApprovalContext(admin, minted.requestId);
  if (ctx.state === "not_found") return apiError(500, "Target vanished after creation", headers);

  const delivery = await deliverApprovalLink(
    parsed.data.deliveredVia,
    parsed.data.deliveredTo,
    resolved.tenantSlug,
    ctx.target,
    minted.url
  );
  if (!delivery.ok) return apiError(502, `Approval request created but delivery failed: ${delivery.error}`, headers);

  return apiOk({ requestId: minted.requestId, expiresAt: minted.expiresAt }, headers);
}
