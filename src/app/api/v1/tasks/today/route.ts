import { corsHeaders, corsPreflight } from "@/lib/api/cors";
import { apiOk } from "@/lib/api/respond";
import { requireTasksAuth } from "@/lib/api/tasks-auth";
import { getOccurrencesForDate, getTenantPeople, getTenantTimezone } from "@/lib/services/tasks";
import { getTenantToday } from "@/lib/tasks/date-utils";

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
  const date = searchParams.get("date") || getTenantToday(timezone);
  const person = searchParams.get("person");

  let personId: string | undefined;
  if (person) {
    const people = await getTenantPeople(admin, tenantSlug, { activeOnly: false });
    const match = people.find(
      (p) => p.id === person || p.name.toLowerCase() === person.toLowerCase()
    );
    personId = match?.id ?? person;
  }

  const occurrences = await getOccurrencesForDate(admin, tenantSlug, date, { personId });
  return apiOk({ date, occurrences }, headers);
}
