import { createAdminClient } from "@/lib/supabase/admin";
import { generateMissingOccurrences, markMissedOccurrences } from "@/lib/services/tasks";

export async function GET(request: Request): Promise<Response> {
  return handleCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCron(request);
}

async function handleCron(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Fetch all tenants
  const { data: tenants, error } = await admin.from("tenants").select("slug");
  if (error || !tenants) {
    return Response.json({ error: error?.message ?? "Failed to fetch tenants" }, { status: 500 });
  }

  const results: Record<
    string,
    { occurrencesGenerated: number; markedMissed: number; markedSkipped: number }
  > = {};

  for (const t of tenants) {
    try {
      // 1. Generate missing occurrences up to today + 7
      const generated = await generateMissingOccurrences(admin, t.slug, 7);

      // 2. Mark past pending occurrences as missed or skipped
      const { markedMissed, markedSkipped } = await markMissedOccurrences(admin, t.slug);

      results[t.slug] = {
        occurrencesGenerated: generated,
        markedMissed,
        markedSkipped,
      };
    } catch (err: unknown) {
      console.error(`Daily task cron failed for tenant ${t.slug}:`, err);
      results[t.slug] = {
        occurrencesGenerated: 0,
        markedMissed: 0,
        markedSkipped: 0,
      };
    }
  }

  return Response.json({ success: true, results });
}
