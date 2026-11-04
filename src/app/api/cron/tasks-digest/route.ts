import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantTime, getTenantToday, addDays } from "@/lib/tasks/date-utils";
import {
  getTenantTimezone,
  getOccurrencesForDate,
  getBreaches,
  notifyDiscordTask,
} from "@/lib/services/tasks";

export async function GET(request: Request): Promise<Response> {
  return handleDigest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleDigest(request);
}

async function handleDigest(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: tenants } = await admin.from("tenants").select("slug");
  if (!tenants) return Response.json({ success: true, processed: 0 });

  const processed: string[] = [];

  for (const t of tenants) {
    try {
      const timezone = await getTenantTimezone(admin, t.slug);
      const currentTime = getTenantTime(timezone); // HH:mm:ss
      const currentHour = parseInt(currentTime.slice(0, 2), 10);

      // Only run at 08:00 window (8am local time)
      if (currentHour !== 8) continue;

      const todayStr = getTenantToday(timezone);
      const yesterdayStr = addDays(todayStr, -1);

      // Tasks due today
      const todayOccs = await getOccurrencesForDate(admin, t.slug, todayStr);
      const pendingToday = todayOccs.filter((o) => o.status === "pending");

      // Misses yesterday
      const yesterdayMisses = await getBreaches(admin, t.slug, yesterdayStr, yesterdayStr);

      if (pendingToday.length === 0 && yesterdayMisses.length === 0) continue;

      // Group today's pending by person
      const byPerson = new Map<string, number>();
      for (const occ of pendingToday) {
        const name = occ.owner?.name ?? "Team member";
        byPerson.set(name, (byPerson.get(name) ?? 0) + 1);
      }

      let digestMsg = `🌅 *Pulse Morning Task Digest (${todayStr})*\n\n`;
      if (pendingToday.length > 0) {
        digestMsg += `*Due today (${pendingToday.length}):*\n`;
        for (const [name, count] of byPerson) {
          digestMsg += `• ${name}: ${count} task${count === 1 ? "" : "s"}\n`;
        }
      } else {
        digestMsg += `• No tasks scheduled for today.\n`;
      }

      if (yesterdayMisses.length > 0) {
        digestMsg += `\n*Yesterday's Breaches (${yesterdayMisses.length}):*\n`;
        for (const m of yesterdayMisses) {
          digestMsg += `• ❌ ${m.owner?.name ?? "Someone"}: *${m.task?.title}*\n`;
        }
      }

      await notifyDiscordTask(admin, t.slug, digestMsg);
      processed.push(t.slug);
    } catch (err) {
      console.error(`Task digest failed for ${t.slug}:`, err);
    }
  }

  return Response.json({ success: true, processed });
}
