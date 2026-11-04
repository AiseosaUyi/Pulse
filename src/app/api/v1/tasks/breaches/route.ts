import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiError, apiOk } from "@/lib/api/respond";
import { requireTasksAuth } from "@/lib/api/tasks-auth";
import { getBreaches, getTenantPeople, getTenantTimezone } from "@/lib/services/tasks";
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

  const from = searchParams.get("from") || addDays(todayStr, -14);
  const to = searchParams.get("to") || todayStr;
  const person = searchParams.get("person");

  let personId: string | undefined;
  if (person && person !== "all") {
    const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
    const match = people.find(
      (p) => p.id === person || p.name.toLowerCase() === person.toLowerCase()
    );
    personId = match?.id ?? person;
  }

  try {
    const breaches = await getBreaches(admin, tenantSlug, from, to, personId);
    return apiOk({ from, to, breaches }, headers);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch breaches";
    return apiError(500, message, headers);
  }
}
