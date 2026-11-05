import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { requireTasksAuth } from "@/lib/api/tasks-auth";
import { getStandupReport, getTenantPeople, getTenantTimezone } from "@/lib/services/tasks";
import { addDays, getTenantToday } from "@/lib/tasks/date-utils";

export const dynamic = "force-dynamic";

const METHODS = "GET";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function GET(req: Request) {
  const auth = await requireTasksAuth(req, "tasks:read", METHODS);
  if (!auth.ok) return auth.response;
  const { tenantSlug, admin } = auth.context;
  const headers = corsHeaders(METHODS);

  const { searchParams } = new URL(req.url);
  const timezone = await getTenantTimezone(admin, tenantSlug);
  const todayStr = getTenantToday(timezone);

  let from = searchParams.get("from");
  const to = searchParams.get("to") || todayStr;
  const person = searchParams.get("person");

  if (!from) {
    // Default to Monday of current week
    const [y, m, d] = todayStr.split("-").map(Number);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    from = addDays(todayStr, diffToMonday);
  }

  let personId: string | undefined;
  if (person && person !== "all") {
    const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
    const match = people.find(
      (p) => p.id === person || p.name.toLowerCase() === person.toLowerCase()
    );
    personId = match?.id ?? person;
  }

  try {
    const report = await getStandupReport(admin, tenantSlug, from, to, personId);
    return apiOk(report, headers);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate report";
    return apiError(500, message, headers);
  }
}
