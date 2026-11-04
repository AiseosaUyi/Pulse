import { createClient } from "@supabase/supabase-js";
import {
  createTask,
  createTeamPerson,
  getTenantPeople,
  getTenantTimezone,
} from "../src/lib/services/tasks";
import { getTenantToday } from "../src/lib/tasks/date-utils";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE env vars in .env.local");
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const tenantSlug = "gruve";
  console.log(`Seeding tasks for tenant: ${tenantSlug}...`);

  const timezone = await getTenantTimezone(client, tenantSlug);
  const todayStr = getTenantToday(timezone);

  // 1. Resolve or create team_people
  // Known auth profiles in Gruve
  const KNOWN_MEMBERS = [
    { name: "Olamide", userId: "c776f5c0-ab6f-4783-9611-803a760ad75b" },
    { name: "Abas", userId: "bf83db6b-86ba-4d5a-8f3a-742eb13dd81c" },
    { name: "Abdul", userId: "4ba907de-8329-4c0a-923e-81adf6ef6542" },
    { name: "Aise", userId: "e2e34d7e-828c-4edc-8209-f0c068453662" },
    { name: "Oki", userId: null }, // Ambassador without login
  ];

  const existingPeople = await getTenantPeople(client, tenantSlug, { activeOnly: false });
  const peopleMap = new Map<string, string>(); // name -> id

  for (const km of KNOWN_MEMBERS) {
    const found = existingPeople.find(
      (p) => p.name.toLowerCase() === km.name.toLowerCase() || (km.userId && p.userId === km.userId)
    );
    if (found) {
      peopleMap.set(km.name, found.id);
      console.log(`Found existing team person: ${found.name} (${found.id})`);
    } else {
      const created = await createTeamPerson(client, tenantSlug, {
        name: km.name,
        userId: km.userId,
      });
      peopleMap.set(km.name, created.id);
      console.log(`Created team person: ${created.name} (${created.id})`);
    }
  }

  const olamideId = peopleMap.get("Olamide")!;
  const abasId = peopleMap.get("Abas")!;
  const abdulId = peopleMap.get("Abdul")!;
  const aiseId = peopleMap.get("Aise")!;
  const okiId = peopleMap.get("Oki")!;
  const creatorId = "e2e34d7e-828c-4edc-8209-f0c068453662"; // Aise (admin)

  // 2. Define Tasks to seed (from Section 10 of build spec)
  const tasksToSeed = [
    // Olamide
    {
      title: "Daily post on Gruve Lagos",
      ownerPersonId: olamideId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "daily" as const,
      proofRequired: "link" as const,
      proofHint: "Paste the Discord #gruve-daily message link",
      checklist: [
        "Posted on @gruve_official",
        "Collab invite sent to the organiser (if it's an event post)",
        "Shared in Discord with yesterday's views and follows",
      ],
      metricLabel: "Followers gained",
      metricTarget: null,
      tags: ["social"],
    },
    {
      title: "This week in Lagos slides",
      ownerPersonId: olamideId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [1], // Monday
      proofRequired: "link" as const,
      tags: ["social"],
    },
    {
      title: "Area reel",
      ownerPersonId: olamideId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [3], // Wednesday
      proofRequired: "link" as const,
      tags: ["social", "video"],
    },
    {
      title: "Don't be bored this weekend roundup",
      ownerPersonId: olamideId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [4], // Thursday
      priority: "high" as const,
      proofRequired: "link" as const,
      tags: ["social"],
    },
    {
      title: "Event reel shot at an event",
      ownerPersonId: olamideId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [6], // Saturday
      proofRequired: "link" as const,
      tags: ["social", "video"],
    },
    {
      title: "Reply to all comments",
      ownerPersonId: olamideId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "daily" as const,
      proofRequired: "none" as const,
      tags: ["social", "engagement"],
    },

    // Abas
    {
      title: "Clear Pulse Today and the IG inbox",
      ownerPersonId: abasId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "daily" as const,
      proofRequired: "note" as const,
      proofHint: "Who did you reply to",
      tags: ["inbox", "support"],
    },
    {
      title: "Ambassador outreach check-in",
      ownerPersonId: abasId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekdays" as const,
      proofRequired: "none" as const,
      metricLabel: "DMs sent by ambassadors",
      metricTarget: null,
      tags: ["ambassadors"],
    },

    // Abdul
    {
      title: "Send outreach from Pulse Pipeline",
      ownerPersonId: abdulId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekdays" as const,
      proofRequired: "none" as const,
      metricLabel: "First messages sent",
      metricTarget: 10,
      tags: ["outreach", "pipeline"],
    },
    {
      title: "Chase list",
      ownerPersonId: abdulId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [1, 4], // Monday and Thursday
      proofRequired: "note" as const,
      tags: ["outreach"],
    },

    // Everyone
    ...[olamideId, abasId, abdulId, aiseId, okiId].map((personId) => ({
      title: "Friday standup numbers ready",
      ownerPersonId: personId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [5], // Friday
      dueTime: "10:00:00",
      proofRequired: "note" as const,
      tags: ["standup"],
    })),
  ];

  // Check existing tasks to avoid duplicates
  const { data: existingTasks } = await client
    .from("tasks")
    .select("id, title, owner_person_id")
    .eq("tenant_slug", tenantSlug);

  for (const t of tasksToSeed) {
    const alreadyExists = (existingTasks ?? []).some(
      (et) => et.title === t.title && et.owner_person_id === t.ownerPersonId
    );

    if (alreadyExists) {
      console.log(`Task already exists: "${t.title}" for owner ${t.ownerPersonId}`);
      continue;
    }

    try {
      const created = await createTask(client, tenantSlug, t, creatorId);
      console.log(`Created task: "${created.title}" (ID: ${created.id})`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to create task "${t.title}":`, message);
    }
  }

  console.log("Gruve tasks seed complete! 🎉");
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
