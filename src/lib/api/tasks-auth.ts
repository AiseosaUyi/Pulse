import { requireApiContext } from "@/lib/api/context";
import { extractBearer } from "@/lib/api-tokens";
import { hasScope, type ApiV1Scope } from "@/lib/api/scopes";
import { corsHeaders } from "@/lib/api/cors";
import { apiError } from "@/lib/api/respond";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export interface TasksAuthContext {
  tenantSlug: string;
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  isAdmin: boolean;
}

export type TasksAuthResult =
  | { ok: true; context: TasksAuthContext }
  | { ok: false; response: Response };

export async function requireTasksAuth(
  req: Request,
  requiredScope: ApiV1Scope,
  methods: string
): Promise<TasksAuthResult> {
  const headers = corsHeaders(methods);
  const bearer = extractBearer(req);

  if (bearer) {
    const apiCtx = await requireApiContext(req, requiredScope, methods);
    if (!apiCtx.ok) return apiCtx;

    if (!apiCtx.context.createdBy && requiredScope.includes("write")) {
      return {
        ok: false,
        response: apiError(400, "API token must have an associated creator user to perform task mutations", headers),
      };
    }

    const isAdmin = hasScope(apiCtx.context.scopes, "admin");

    return {
      ok: true,
      context: {
        tenantSlug: apiCtx.context.tenantSlug,
        admin: apiCtx.context.admin,
        userId: apiCtx.context.createdBy ?? "",
        isAdmin,
      },
    };
  }

  // Session auth fallback for browser UI
  try {
    const user = await getCurrentUser();
    const tenant = await getCurrentTenant();
    if (!user || !tenant) {
      return { ok: false, response: apiError(401, "Unauthorized", headers) };
    }

    const isAdmin = tenant.role === "owner" || tenant.role === "admin";
    return {
      ok: true,
      context: {
        tenantSlug: tenant.slug,
        admin: createAdminClient(),
        userId: user.id,
        isAdmin,
      },
    };
  } catch {
    return { ok: false, response: apiError(401, "Unauthorized", headers) };
  }
}
