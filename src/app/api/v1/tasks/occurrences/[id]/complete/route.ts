import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { requireTasksAuth } from "@/lib/api/tasks-auth";
import { completeOccurrence } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

const METHODS = "POST";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const auth = await requireTasksAuth(req, "tasks:write", METHODS);
  if (!auth.ok) return auth.response;
  const { tenantSlug, admin, userId, isAdmin } = auth.context;
  const headers = corsHeaders(METHODS);

  try {
    const body = (await req.json()) as {
      proofUrl?: string | null;
      proofNote?: string | null;
      proofImagePath?: string | null;
      metricValue?: number | null;
    };

    const result = await completeOccurrence(admin, tenantSlug, {
      occurrenceId: id,
      completedBy: userId,
      isAdmin,
      proofUrl: body.proofUrl,
      proofNote: body.proofNote,
      proofImagePath: body.proofImagePath,
      metricValue: body.metricValue,
    });

    if (!result.ok) {
      return apiError(400, result.error ?? "Failed to complete occurrence", headers);
    }

    return apiOk({ success: true, occurrenceId: id }, headers);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to complete occurrence";
    return apiError(400, message, headers);
  }
}
