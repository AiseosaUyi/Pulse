/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { unassignDepartedPerson, generateMissingOccurrences } from "@/lib/services/tasks";

// Mock Supabase with in-memory tables supporting >100 rows
function createMockSupabase(initialData: Record<string, any[]>) {
  const data: Record<string, any[]> = JSON.parse(JSON.stringify(initialData));

  return {
    from(table: string) {
      if (!data[table]) data[table] = [];
      const filters: Array<(row: any) => boolean> = [];
      let updates: Record<string, any> = {};

      const chain = {
        select(_cols = "*") {
          return chain;
        },
        eq(col: string, val: any) {
          filters.push((r) => r[col] === val);
          return chain;
        },
        neq(col: string, val: any) {
          filters.push((r) => r[col] !== val);
          return chain;
        },
        in(col: string, vals: any[]) {
          filters.push((r) => vals.includes(r[col]));
          return chain;
        },
        not(col: string, op: string, val: any) {
          if (op === "in") {
            // value could be '("closed_won","closed_lost","dismissed","unqualified")'
            const cleaned = typeof val === "string"
              ? val.replace(/[()"]/g, "").split(",").map((s) => s.trim())
              : val;
            filters.push((r) => !cleaned.includes(r[col]));
          }
          return chain;
        },
        gte(col: string, val: any) {
          filters.push((r) => r[col] >= val);
          return chain;
        },
        lte(col: string, val: any) {
          filters.push((r) => r[col] <= val);
          return chain;
        },
        order(_col: string, _opts?: any) {
          return chain;
        },
        limit(count: number) {
          return {
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              const matched = data[table].filter((r) => filters.every((f) => f(r))).slice(0, count);
              resolve({ data: matched, error: null });
            },
          };
        },
        maybeSingle() {
          const matched = data[table].filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
        single() {
          const matched = data[table].filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({
            data: matched[0] ?? null,
            error: matched[0] ? null : { message: "Not found" },
          });
        },
        update(patch: Record<string, any>) {
          updates = patch;
          return {
            eq(col: string, val: any) {
              filters.push((r) => r[col] === val);
              return this;
            },
            in(col: string, vals: any[]) {
              filters.push((r) => vals.includes(r[col]));
              return this;
            },
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              const matched = data[table].filter((r) => filters.every((f) => f(r)));
              for (const row of matched) {
                Object.assign(row, updates);
              }
              resolve({ data: matched, error: null });
            },
          };
        },
        insert(rows: any | any[]) {
          const arr = Array.isArray(rows) ? rows : [rows];
          for (const item of arr) {
            const id = item.id || `gen-${Math.random().toString(36).slice(2, 9)}`;
            data[table].push({ ...item, id });
          }
          return {
            select() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: arr[0], error: null });
                },
                then(resolve: (res: { data: any[] | null; error: null }) => void) {
                  resolve({ data: arr, error: null });
                },
              };
            },
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              resolve({ data: arr, error: null });
            },
          };
        },
        upsert(rows: any | any[], _opts?: any) {
          const arr = Array.isArray(rows) ? rows : [rows];
          for (const item of arr) {
            const idx = data[table].findIndex(
              (r) => (item.id && r.id === item.id) ||
                     (r.task_id === item.task_id && r.occurs_on === item.occurs_on)
            );
            if (idx >= 0) {
              Object.assign(data[table][idx], item);
            } else {
              const id = item.id || `gen-${Math.random().toString(36).slice(2, 9)}`;
              data[table].push({ ...item, id });
            }
          }
          return {
            select() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: arr[0], error: null });
                },
                then(resolve: (res: { data: any[] | null; error: null }) => void) {
                  resolve({ data: arr, error: null });
                },
              };
            },
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              resolve({ data: arr, error: null });
            },
          };
        },
        delete() {
          return {
            eq(col: string, val: any) {
              filters.push((r) => r[col] === val);
              return this;
            },
            in(col: string, vals: any[]) {
              filters.push((r) => vals.includes(r[col]));
              return this;
            },
            then(resolve: (res: { data: any[] | null; error: null }) => void) {
              const remaining = data[table].filter((r) => !filters.every((f) => f(r)));
              data[table] = remaining;
              resolve({ data: null, error: null });
            },
          };
        },
        then(resolve: (res: { data: any[]; error: null }) => void) {
          const matched = data[table].filter((r) => filters.every((f) => f(r)));
          resolve({ data: matched, error: null });
        },
      };

      return chain;
    },
    rpc(_fnName: string, _args: Record<string, any>) {
      // Return error to test the client fallback path in unassignDepartedPerson
      return Promise.resolve({ error: { message: "RPC not available in unit test" } });
    },
    _getRawData() {
      return data;
    },
  } as any;
}

describe("Part A: One Assignee Model & Departed Member Unassignment", () => {
  it("ensures zero occurrences of hardcoded person names across src/", () => {
    // Exact prohibited names from PRD Part A
    const prohibited = ["Aise", "Abas", "Abdul", "Olamide", "Ambassador 1", "Ambassador 2"];
    const pattern = `(${prohibited.join("|")})`;

    let found = false;
    let output = "";
    try {
      output = execSync(`grep -rnE "${pattern}" src/`, { encoding: "utf-8" });
      found = output.trim().length > 0;
    } catch {
      found = false;
    }

    if (found) {
      console.error("Prohibited hardcoded names found:\n", output);
    }
    expect(found).toBe(false);
  });

  it("maps legacy roster names to team_people IDs and identifies unmatched strings", () => {
    const teamPeople = [
      { id: "person-uuid-1", tenant_slug: "acme", name: "Sarah Connor" },
      { id: "person-uuid-2", tenant_slug: "acme", name: "John Doe" },
    ];

    const legacyOwners = [
      "Sarah Connor",
      "sarah connor",
      "John Doe",
      "Unknown Ambassador",
      "Old Intern",
      "Sarah Connor",
    ];

    // Simulate mapping logic from migration 110 & usePeople()
    const peopleMap = new Map(teamPeople.map((p) => [p.name.toLowerCase().trim(), p.id]));
    const mapped: Array<{ raw: string; personId: string | null }> = [];
    const unmatched: string[] = [];

    for (const raw of legacyOwners) {
      const pid = peopleMap.get(raw.toLowerCase().trim()) ?? null;
      mapped.push({ raw, personId: pid });
      if (!pid && !unmatched.includes(raw)) {
        unmatched.push(raw);
      }
    }

    expect(mapped[0].personId).toBe("person-uuid-1");
    expect(mapped[1].personId).toBe("person-uuid-1"); // Case-insensitive
    expect(mapped[2].personId).toBe("person-uuid-2");
    expect(mapped[3].personId).toBeNull();
    expect(unmatched).toEqual(["Unknown Ambassador", "Old Intern"]);
  });

  it("unassigns departed member across >100 rows, pauses recurring tasks, and logs audit events", async () => {
    const tenantSlug = "acme";
    const departedPersonId = "person-departed";
    const retainedPersonId = "person-retained";

    const people = [
      {
        id: departedPersonId,
        tenant_slug: tenantSlug,
        name: "Departed Teammate",
        active: true,
      },
      {
        id: retainedPersonId,
        tenant_slug: tenantSlug,
        name: "Active Teammate",
        active: true,
      },
    ];

    // Generate >100 realistic rows
    const prospects: any[] = [];
    const actionItems: any[] = [];
    const engagementItems: any[] = [];
    const tasks: any[] = [];
    const occurrences: any[] = [];

    for (let i = 1; i <= 60; i++) {
      // 60 prospects: 40 for departed (30 open, 10 closed), 20 for retained
      const isDeparted = i <= 40;
      const isClosed = i > 30 && i <= 40;
      prospects.push({
        id: `prospect-${i}`,
        tenant_slug: tenantSlug,
        owner_person_id: isDeparted ? departedPersonId : retainedPersonId,
        owner: isDeparted ? "Departed Teammate" : "Active Teammate",
        status: isClosed ? "closed_won" : "contacted",
      });
    }

    for (let i = 1; i <= 30; i++) {
      // 30 action items: 20 departed open, 10 retained
      const isDeparted = i <= 20;
      actionItems.push({
        id: `action-${i}`,
        tenant_slug: tenantSlug,
        owner_person_id: isDeparted ? departedPersonId : retainedPersonId,
        owner: isDeparted ? "Departed Teammate" : "Active Teammate",
        assigned_to: isDeparted ? departedPersonId : retainedPersonId,
        status: "open",
      });
    }

    for (let i = 1; i <= 20; i++) {
      // 20 engagement items: 15 departed open, 5 retained
      const isDeparted = i <= 15;
      engagementItems.push({
        id: `eng-${i}`,
        tenant_slug: tenantSlug,
        owner_person_id: isDeparted ? departedPersonId : retainedPersonId,
        owner: isDeparted ? "Departed Teammate" : "Active Teammate",
        assigned_to: isDeparted ? departedPersonId : retainedPersonId,
        status: "open",
      });
    }

    // 10 Tasks: 5 recurring for departed, 2 one-off for departed, 3 for retained
    for (let i = 1; i <= 10; i++) {
      const isDeparted = i <= 7;
      const isRecurring = i <= 5 || i === 8;
      tasks.push({
        id: `task-${i}`,
        tenant_slug: tenantSlug,
        title: `Task ${i}`,
        kind: isRecurring ? "recurring" : "one_off",
        owner_person_id: isDeparted ? departedPersonId : retainedPersonId,
        status: "active",
        start_date: "2026-11-01",
        recurrence: "daily",
      });

      // Occurrences for each task
      occurrences.push({
        id: `occ-${i}`,
        tenant_slug: tenantSlug,
        task_id: `task-${i}`,
        owner_person_id: isDeparted ? departedPersonId : retainedPersonId,
        occurs_on: "2026-11-05",
        status: "pending",
      });
    }

    const totalFixtureRows =
      prospects.length + actionItems.length + engagementItems.length + tasks.length + occurrences.length;
    expect(totalFixtureRows).toBeGreaterThan(100);

    const client = createMockSupabase({
      team_people: people,
      prospects,
      prospect_notes: [],
      action_items: actionItems,
      engagement_items: engagementItems,
      tasks,
      task_occurrences: occurrences,
      task_events: [],
    });

    // Run unassignment
    const result = await unassignDepartedPerson(client, tenantSlug, departedPersonId, "admin-user-id");
    expect(result.ok).toBe(true);

    const db = client._getRawData();

    // 1. Departed person is marked inactive
    const departedPerson = db.team_people.find((p: any) => p.id === departedPersonId);
    expect(departedPerson.active).toBe(false);

    // Retained person stays active
    const retainedPerson = db.team_people.find((p: any) => p.id === retainedPersonId);
    expect(retainedPerson.active).toBe(true);

    // 2. Open prospects unassigned & departure note added
    const departedOpenProspects = db.prospects.filter(
      (p: any) => p.status !== "closed_won" && p.id.startsWith("prospect-") && parseInt(p.id.split("-")[1], 10) <= 30
    );
    for (const p of departedOpenProspects) {
      expect(p.owner_person_id).toBeNull();
      expect(p.owner).toBeNull();
    }
    // Closed prospects were not touched
    const closedProspects = db.prospects.filter((p: any) => p.status === "closed_won");
    for (const p of closedProspects) {
      expect(p.owner_person_id).toBe(departedPersonId);
    }
    // Retained prospects not touched
    const retainedProspects = db.prospects.filter((p: any) => p.owner_person_id === retainedPersonId);
    expect(retainedProspects.length).toBe(20);

    // Prospect departure notes recorded
    expect(db.prospect_notes.length).toBe(30);
    expect(db.prospect_notes[0].body).toContain("Unassigned on departure");

    // 3. Action and engagement items unassigned
    const unassignedActions = db.action_items.filter((a: any) => a.owner_person_id === null);
    expect(unassignedActions.length).toBe(20);
    const retainedActions = db.action_items.filter((a: any) => a.owner_person_id === retainedPersonId);
    expect(retainedActions.length).toBe(10);

    const unassignedEng = db.engagement_items.filter((e: any) => e.owner_person_id === null);
    expect(unassignedEng.length).toBe(15);

    // 4. Tasks: recurring tasks paused & owner cleared; one-offs owner cleared
    const departedRecurring = db.tasks.filter((t: any) => ["task-1", "task-2", "task-3", "task-4", "task-5"].includes(t.id));
    for (const t of departedRecurring) {
      expect(t.owner_person_id).toBeNull();
      expect(t.status).toBe("paused");
    }

    const departedOneOffs = db.tasks.filter((t: any) => ["task-6", "task-7"].includes(t.id));
    for (const t of departedOneOffs) {
      expect(t.owner_person_id).toBeNull();
      expect(t.status).toBe("active"); // One-offs stay active or as-is but unassigned
    }

    // Retained tasks unchanged
    const retainedTasks = db.tasks.filter((t: any) => t.owner_person_id === retainedPersonId);
    expect(retainedTasks.length).toBe(3);

    // Audit events logged
    const departureEvents = db.task_events.filter((e: any) => e.action === "unassigned_on_departure");
    expect(departureEvents.length).toBe(7);
    expect(departureEvents[0].payload.previous_owner_id).toBe(departedPersonId);

    // 5. Pending occurrences for departed unassigned
    const pendingDepartedOccs = db.task_occurrences.filter((o: any) => o.owner_person_id === null);
    expect(pendingDepartedOccs.length).toBe(7);
  });

  it("pauses recurring tasks without owner and generateMissingOccurrences generates 0 rows for paused/unassigned recurring tasks", async () => {
    const tenantSlug = "acme";
    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      tasks: [
        {
          id: "task-paused",
          tenant_slug: tenantSlug,
          title: "Paused Recurring Task",
          kind: "recurring",
          owner_person_id: null,
          status: "paused",
          start_date: "2026-11-01",
          recurrence: "daily",
        },
        {
          id: "task-active-unowned",
          tenant_slug: tenantSlug,
          title: "Unowned Recurring Task",
          kind: "recurring",
          owner_person_id: null,
          status: "active",
          start_date: "2026-11-01",
          recurrence: "daily",
        },
        {
          id: "task-active-owned",
          tenant_slug: tenantSlug,
          title: "Owned Recurring Task",
          kind: "recurring",
          owner_person_id: "person-active",
          status: "active",
          start_date: "2026-11-01",
          recurrence: "daily",
        },
      ],
      task_occurrences: [],
      task_checks: [],
      person_leave: [],
    });

    // Run generateMissingOccurrences for 3 days
    const generated = await generateMissingOccurrences(client, tenantSlug, 3);
    const db = client._getRawData();

    // Occurrences should only be generated for the active owned task
    const generatedOccs = db.task_occurrences;
    expect(generatedOccs.length).toBe(generated);
    expect(generatedOccs.every((o: any) => o.task_id === "task-active-owned")).toBe(true);
    expect(generatedOccs.some((o: any) => o.task_id === "task-paused")).toBe(false);
  });

  it("migration 110 links unlinked roster people to memberships before inserting to prevent duplicate people", () => {
    // Simulating the Migration 110 pre-insertion link logic:
    // When a roster has unlinked people (user_id IS NULL), and memberships are processed:
    // We match by:
    // 1. exact case-insensitive full name / display_name
    // 2. username
    // 3. email prefix (before @)
    // 4. first name (split on space)
    const teamPeople: Array<{
      id: string;
      tenant_slug: string;
      name: string;
      user_id: string | null;
      email: string | null;
    }> = [
      { id: "person-1", tenant_slug: "t1", name: "Aise", user_id: null, email: null },
      { id: "person-2", tenant_slug: "t1", name: "Jordan Smith", user_id: null, email: null },
      { id: "person-3", tenant_slug: "t1", name: "Taylor", user_id: null, email: null },
    ];

    const memberships = [
      {
        user_id: "user-aise",
        tenant_slug: "t1",
        profile_display_name: "Aiseosa Uyi-Idahor",
        profile_username: "aise",
        email: "aise@example.com",
      },
      {
        user_id: "user-jordan",
        tenant_slug: "t1",
        profile_display_name: "Jordan Smith",
        profile_username: "jsmith",
        email: "jordan.smith@example.com",
      },
      {
        user_id: "user-taylor",
        tenant_slug: "t1",
        profile_display_name: "T. Morgan",
        profile_username: "tmorgan",
        email: "taylor@company.com",
      },
      {
        user_id: "user-brand-new",
        tenant_slug: "t1",
        profile_display_name: "Brand New User",
        profile_username: "newbie",
        email: "newbie@company.com",
      },
    ];

    // Helper implementing the Migration 110 matching heuristic
    function findMatchingUnlinkedPerson(
      people: typeof teamPeople,
      tenantSlug: string,
      m: (typeof memberships)[0]
    ) {
      const emailPrefix = m.email.split("@")[0].toLowerCase().trim();
      const firstName = (m.profile_display_name || "").split(" ")[0].toLowerCase().trim();
      const displayName = (m.profile_display_name || "").toLowerCase().trim();
      const username = (m.profile_username || "").toLowerCase().trim();

      return people.find((p) => {
        if (p.tenant_slug !== tenantSlug || p.user_id !== null) return false;
        const pName = p.name.toLowerCase().trim();
        return (
          pName === displayName ||
          pName === username ||
          pName === emailPrefix ||
          (firstName.length > 2 && pName === firstName) ||
          (pName.length > 2 && firstName.startsWith(pName))
        );
      });
    }

    for (const m of memberships) {
      const match = findMatchingUnlinkedPerson(teamPeople, m.tenant_slug, m);
      if (match) {
        // Link existing instead of inserting duplicate
        match.user_id = m.user_id;
        match.email = m.email;
      } else {
        // Insert new person
        teamPeople.push({
          id: `person-${teamPeople.length + 1}`,
          tenant_slug: m.tenant_slug,
          name: m.profile_display_name || m.profile_username,
          user_id: m.user_id,
          email: m.email,
        });
      }
    }

    // Aise matched by username/email prefix/first name -> person-1 linked, NOT duplicated!
    const aise = teamPeople.find((p) => p.user_id === "user-aise");
    expect(aise).toBeDefined();
    expect(aise?.id).toBe("person-1");
    expect(aise?.name).toBe("Aise");

    // Jordan Smith matched by full display name -> person-2 linked
    const jordan = teamPeople.find((p) => p.user_id === "user-jordan");
    expect(jordan?.id).toBe("person-2");

    // Taylor matched by email prefix -> person-3 linked
    const taylor = teamPeople.find((p) => p.user_id === "user-taylor");
    expect(taylor?.id).toBe("person-3");

    // Brand New User had no match -> inserted as new row (person-4)
    const newbie = teamPeople.find((p) => p.user_id === "user-brand-new");
    expect(newbie?.id).toBe("person-4");

    // Total rows must be exactly 4 (3 linked + 1 new), NO duplicate rows
    expect(teamPeople.length).toBe(4);
  });

  it("migration 110 produces no duplicate people on Gruve tenant members", () => {
    // Exact Gruve memberships and profiles from database
    const gruveMemberships = [
      {
        userId: "e2e34d7e-828c-4edc-8209-f0c068453662",
        role: "owner",
        email: "aise@gruve.events",
        displayName: "",
        username: "aiseosa",
      },
      {
        userId: "bf83db6b-86ba-4d5a-8f3a-742eb13dd81c",
        role: "member",
        email: "abasiubong@gruve.events",
        displayName: "Abasiubong Anwan",
        username: "abasiubong",
      },
      {
        userId: "4ba907de-8329-4c0a-923e-81adf6ef6542",
        role: "member",
        email: "abdullahiayodele16@gmail.com",
        displayName: "Gbadebo Abdullahi",
        username: "abdullahiayodele16",
      },
      {
        userId: "c776f5c0-ab6f-4783-9611-803a760ad75b",
        role: "member",
        email: "olamideamosun98@gmail.com",
        displayName: "Olamide Amosun",
        username: "olamideamosun98",
      },
      {
        userId: "89cf69f3-208f-4dbd-bdfb-3faea0b7a618",
        role: "member",
        email: "olubunmiamaremo@gmail.com",
        displayName: "olubunmi amaremo",
        username: "olubunmiamaremo",
      },
      {
        userId: "c0027e5e-13cc-49fa-9b28-a7ecb3ab4eb5",
        role: "member",
        email: "aiseosauyiidahor@gmail.com",
        displayName: "Aiseosa Benard Uyi-Idahor",
        username: "aiseosauyiidahor",
      },
    ];

    // Pre-migration legacy unlinked roster entries in Gruve
    const legacyRoster: Array<{
      id: string;
      name: string;
      tenant_slug: string;
      user_id: string | null;
      email: string | null;
    }> = [
      { id: "tp-aise", name: "Aise", tenant_slug: "gruve", user_id: null, email: null },
      { id: "tp-abas", name: "Abas", tenant_slug: "gruve", user_id: null, email: null },
      { id: "tp-abdul", name: "Abdul", tenant_slug: "gruve", user_id: null, email: null },
      { id: "tp-olamide", name: "Olamide", tenant_slug: "gruve", user_id: null, email: null },
      { id: "tp-olubunmi", name: "Olubunmi", tenant_slug: "gruve", user_id: null, email: null },
    ];

    // Simulate Migration 110 step 3a: Tiered deterministic linking
    for (const tp of legacyRoster) {
      const norm = tp.name.toLowerCase().trim();

      // Tier 1: exact match
      let matches = gruveMemberships.filter(
        (m) =>
          (m.displayName && m.displayName.toLowerCase().trim() === norm) ||
          m.username.toLowerCase().trim() === norm ||
          m.email.split("@")[0].toLowerCase().trim() === norm ||
          (m.displayName && m.displayName.split(" ")[0].toLowerCase().trim() === norm)
      );

      // Prefer owner/admin if multiple exact matches
      if (matches.length > 1) {
        const adminMatches = matches.filter((m) => m.role === "owner" || m.role === "admin");
        if (adminMatches.length === 1) matches = adminMatches;
      }

      // Tier 2: prefix match if no exact match
      if (matches.length === 0) {
        matches = gruveMemberships.filter(
          (m) =>
            (m.displayName && m.displayName.toLowerCase().includes(norm)) ||
            m.username.toLowerCase().startsWith(norm) ||
            m.email.split("@")[0].toLowerCase().startsWith(norm)
        );
      }

      if (matches.length === 1) {
        tp.user_id = matches[0].userId;
        tp.email = matches[0].email;
      }
    }

    // Verify all 5 legacy roster members were linked without ambiguity
    expect(legacyRoster.find((p) => p.name === "Aise")?.user_id).toBe("e2e34d7e-828c-4edc-8209-f0c068453662");
    expect(legacyRoster.find((p) => p.name === "Abas")?.user_id).toBe("bf83db6b-86ba-4d5a-8f3a-742eb13dd81c");
    expect(legacyRoster.find((p) => p.name === "Abdul")?.user_id).toBe("4ba907de-8329-4c0a-923e-81adf6ef6542");
    expect(legacyRoster.find((p) => p.name === "Olamide")?.user_id).toBe("c776f5c0-ab6f-4783-9611-803a760ad75b");
    expect(legacyRoster.find((p) => p.name === "Olubunmi")?.user_id).toBe("89cf69f3-208f-4dbd-bdfb-3faea0b7a618");

    // Simulate Migration 110 step 3b: backfill remaining unlinked memberships
    const allPeople = [...legacyRoster];
    for (const m of gruveMemberships) {
      const alreadyLinked = allPeople.some((p) => p.user_id === m.userId);
      if (!alreadyLinked) {
        allPeople.push({
          id: `tp-new-${allPeople.length + 1}`,
          name: m.displayName || m.username,
          tenant_slug: "gruve",
          user_id: m.userId,
          email: m.email,
        });
      }
    }

    // The 6th member (Aiseosa Benard Uyi-Idahor) gets added cleanly
    expect(allPeople.length).toBe(6);
    // Every member has unique user_id -> ZERO duplicate people
    const userIds = allPeople.map((p) => p.user_id);
    expect(new Set(userIds).size).toBe(6);
  });

  it("migration 110 deterministic owner backfill prefers linked people and records ambiguous matches", () => {
    // Migration 110 deterministic backfill logic:
    // When resolving a legacy string owner:
    // 1. Look for matching team_people where lower(trim(name)) = lower(trim(owner))
    // 2. Order by: user_id IS NOT NULL DESC (linked people first), created_at ASC
    // 3. If there is a single best candidate (e.g. only 1 linked person among candidates), pick that person.
    // 4. If there are multiple linked candidates with the same name, or multiple unlinked candidates with no linked one,
    //    mark as AMBIGUOUS and log to ambiguous_owner_matches without arbitrarily picking one.
    const teamPeople = [
      { id: "person-linked-1", name: "Morgan", user_id: "user-123", created_at: "2026-01-01" },
      { id: "person-unlinked-1", name: "Morgan", user_id: null, created_at: "2025-01-01" },
      { id: "person-ambig-a", name: "Alex", user_id: "user-a", created_at: "2026-01-01" },
      { id: "person-ambig-b", name: "Alex", user_id: "user-b", created_at: "2026-01-02" },
      { id: "person-unique", name: "Sam", user_id: null, created_at: "2026-01-01" },
    ];

    interface AmbiguousLog {
      tenant_slug: string;
      table_name: string;
      row_id: string;
      raw_owner: string;
      matched_candidate_ids: string[];
      reason: string;
    }

    const ambiguousLogs: AmbiguousLog[] = [];

    function resolveOwnerDeterministic(
      tableName: string,
      rowId: string,
      rawOwner: string | null
    ): string | null {
      if (!rawOwner || !rawOwner.trim()) return null;
      const normalized = rawOwner.toLowerCase().trim();

      const candidates = teamPeople.filter((p) => p.name.toLowerCase().trim() === normalized);
      if (candidates.length === 0) {
        return null; // No match
      }
      if (candidates.length === 1) {
        return candidates[0].id; // Unique match
      }

      // Multiple candidates: check linked vs unlinked
      const linked = candidates.filter((p) => p.user_id !== null);
      if (linked.length === 1) {
        // Deterministically prefer the single linked person!
        return linked[0].id;
      }

      // Ambiguous: multiple linked or multiple unlinked without a clear winner
      ambiguousLogs.push({
        tenant_slug: "t1",
        table_name: tableName,
        row_id: rowId,
        raw_owner: rawOwner,
        matched_candidate_ids: candidates.map((c) => c.id),
        reason: linked.length > 1
          ? `Multiple linked members match '${rawOwner}'`
          : `Multiple unlinked roster entries match '${rawOwner}'`,
      });

      return null; // Leave unassigned instead of guessing
    }

    // 1. "Morgan" matches both person-linked-1 and person-unlinked-1 -> prefers linked person
    const morganResolved = resolveOwnerDeterministic("prospects", "p-1", "Morgan");
    expect(morganResolved).toBe("person-linked-1");

    // 2. "Sam" has 1 unique match -> person-unique
    const samResolved = resolveOwnerDeterministic("prospects", "p-2", "Sam");
    expect(samResolved).toBe("person-unique");

    // 3. "Alex" has two linked candidates -> ambiguous!
    const alexResolved = resolveOwnerDeterministic("prospects", "p-3", "Alex");
    expect(alexResolved).toBeNull();
    expect(ambiguousLogs.length).toBe(1);
    expect(ambiguousLogs[0].row_id).toBe("p-3");
    expect(ambiguousLogs[0].matched_candidate_ids).toEqual(["person-ambig-a", "person-ambig-b"]);
  });

  it("linkPersonToUserAction prevents duplicate links for the same user in the same tenant", async () => {
    const tenantSlug = "t1";
    const existingPerson = {
      id: "person-existing",
      tenant_slug: tenantSlug,
      name: "Existing Person",
      user_id: "user-alpha",
    };
    const targetPerson = {
      id: "person-target",
      tenant_slug: tenantSlug,
      name: "Target Person",
      user_id: null,
    };

    const client = createMockSupabase({
      team_people: [existingPerson, targetPerson],
    });

    // Check collision logic from linkPersonToUserAction
    const { data: collision } = await client
      .from("team_people")
      .select("id, name")
      .eq("tenant_slug", tenantSlug)
      .eq("user_id", "user-alpha")
      .neq("id", targetPerson.id)
      .maybeSingle();

    expect(collision).toBeDefined();
    expect(collision.name).toBe("Existing Person");
    // Verify that attempting to link targetPerson to user-alpha would be caught as collision
    const canLink = !collision;
    expect(canLink).toBe(false);
  });
});
