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

  // 1. Resolve or create team_people by looking users up via email
  const TARGET_ROLES = [
    { key: "social", emailQuery: process.env.GRUVE_SOCIAL_EMAIL || "olamide", defaultName: "Social Media Lead", role: "Social Lead" },
    { key: "inbox", emailQuery: process.env.GRUVE_INBOX_EMAIL || "abas", defaultName: "Community & Inbox Lead", role: "Support Lead" },
    { key: "outreach", emailQuery: process.env.GRUVE_OUTREACH_EMAIL || "abdul", defaultName: "Growth & Outreach Lead", role: "Growth Lead" },
    { key: "admin", emailQuery: process.env.GRUVE_ADMIN_EMAIL || "aise", defaultName: "Founder", role: "Admin" },
    { key: "ambassador", emailQuery: process.env.GRUVE_AMBASSADOR_EMAIL || "ambassador", defaultName: "Campus Ambassador", role: "Ambassador" },
  ];

  const { data: usersData } = await client.auth.admin.listUsers();
  const allUsers = usersData?.users ?? [];

  const existingPeople = await getTenantPeople(client, tenantSlug, { activeOnly: false });
  const rolePeopleMap = new Map<string, string>(); // roleKey -> personId
  let resolvedCreatorId: string | null = null;

  for (const r of TARGET_ROLES) {
    const matchedUser = allUsers.find((u) =>
      u.email?.toLowerCase().includes(r.emailQuery.toLowerCase())
    );

    const resolvedUserId = matchedUser?.id ?? null;
    const resolvedEmail = matchedUser?.email ?? null;
    const resolvedName = matchedUser?.user_metadata?.display_name ||
      matchedUser?.user_metadata?.full_name ||
      (resolvedEmail ? resolvedEmail.split("@")[0] : r.defaultName);

    if (r.key === "admin" && resolvedUserId) {
      resolvedCreatorId = resolvedUserId;
    }

    // Match against existing team_people by userId, email, or role
    const found = existingPeople.find((p) =>
      (resolvedUserId && p.userId === resolvedUserId) ||
      (resolvedEmail && p.email?.toLowerCase() === resolvedEmail.toLowerCase()) ||
      (p.roleTitle?.toLowerCase() === r.role.toLowerCase())
    );

    if (found) {
      rolePeopleMap.set(r.key, found.id);
      console.log(`Resolved team person for ${r.key}: ${found.name} (${found.id})`);
    } else {
      const created = await createTeamPerson(client, tenantSlug, {
        name: resolvedName,
        userId: resolvedUserId,
        roleTitle: r.role,
        email: resolvedEmail,
      });
      rolePeopleMap.set(r.key, created.id);
      console.log(`Created team person for ${r.key}: ${created.name} (${created.id})`);
    }
  }

  const socialPersonId = rolePeopleMap.get("social")!;
  const inboxPersonId = rolePeopleMap.get("inbox")!;
  const outreachPersonId = rolePeopleMap.get("outreach")!;
  const adminPersonId = rolePeopleMap.get("admin")!;
  const ambassadorPersonId = rolePeopleMap.get("ambassador")!;
  const creatorId = resolvedCreatorId || adminPersonId;

  // 2. Define Tasks to seed (from Section 10 of build spec)
  const tasksToSeed = [
    // Social Media Lead
    {
      title: "Daily post on Gruve Lagos",
      ownerPersonId: socialPersonId,
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
      ownerPersonId: socialPersonId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [1], // Monday
      proofRequired: "link" as const,
      tags: ["social"],
    },
    {
      title: "Area reel",
      ownerPersonId: socialPersonId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [3], // Wednesday
      proofRequired: "link" as const,
      tags: ["social", "video"],
    },
    {
      title: "Don't be bored this weekend roundup",
      ownerPersonId: socialPersonId,
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
      ownerPersonId: socialPersonId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [6], // Saturday
      proofRequired: "link" as const,
      tags: ["social", "video"],
    },
    {
      title: "Reply to all comments",
      ownerPersonId: socialPersonId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "daily" as const,
      proofRequired: "none" as const,
      tags: ["social", "engagement"],
    },

    // Community & Inbox Lead
    {
      title: "Clear Pulse Today and the IG inbox",
      ownerPersonId: inboxPersonId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "daily" as const,
      proofRequired: "note" as const,
      proofHint: "Who did you reply to",
      tags: ["inbox", "support"],
    },
    {
      title: "Ambassador outreach check-in",
      ownerPersonId: inboxPersonId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekdays" as const,
      proofRequired: "none" as const,
      metricLabel: "DMs sent by ambassadors",
      metricTarget: null,
      tags: ["ambassadors"],
    },

    // Growth & Outreach Lead
    {
      title: "Send outreach from Pulse Pipeline",
      ownerPersonId: outreachPersonId,
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
      ownerPersonId: outreachPersonId,
      kind: "recurring" as const,
      startDate: todayStr,
      recurrence: "weekly" as const,
      recurrenceDays: [1, 4], // Monday and Thursday
      proofRequired: "note" as const,
      tags: ["outreach"],
    },

    // Everyone
    ...[socialPersonId, inboxPersonId, outreachPersonId, adminPersonId, ambassadorPersonId].map((personId) => ({
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
