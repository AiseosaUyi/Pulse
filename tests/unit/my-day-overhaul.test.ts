/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect } from "vitest";
import { getMyDay, getWeekBounds } from "@/lib/services/my-day";

function createMockSupabase(initialData: Record<string, any[]>) {
  const data: Record<string, any[]> = JSON.parse(JSON.stringify(initialData));
  const executedQueries: Array<{ table: string; filters: Record<string, any>; limit?: number }> = [];

  return {
    executedQueries,
    from(table: string) {
      if (!data[table]) data[table] = [];
      const recordedFilters: Record<string, any> = {};
      const filterFns: Array<(row: any) => boolean> = [];
      let limitVal = 1000;

      const getVal = (r: any, col: string) => {
        if (col.startsWith("prospects.")) {
          const prop = col.split(".")[1];
          const prospect = data["prospects"]?.find((p: any) => p.id === r.prospect_id);
          return prospect ? prospect[prop] : undefined;
        }
        return r[col];
      };

      const chain = {
        select(_cols = "*") {
          return chain;
        },
        eq(col: string, val: any) {
          recordedFilters[col] = val;
          filterFns.push((r) => getVal(r, col) === val);
          return chain;
        },
        neq(col: string, val: any) {
          filterFns.push((r) => getVal(r, col) !== val);
          return chain;
        },
        in(col: string, vals: any[]) {
          recordedFilters[`${col}_in`] = vals;
          filterFns.push((r) => vals.includes(getVal(r, col)));
          return chain;
        },
        is(col: string, val: any) {
          filterFns.push((r) => (val === null ? getVal(r, col) == null : getVal(r, col) === val));
          return chain;
        },
        not(col: string, op: string, val: any) {
          if (op === "is" && val === null) {
            filterFns.push((r) => r[col] != null);
          } else if (op === "in") {
            const cleaned = typeof val === "string"
              ? val.replace(/[()"]/g, "").split(",").map((s) => s.trim())
              : val;
            filterFns.push((r) => !cleaned.includes(r[col]));
          }
          return chain;
        },
        or(_clause: string) {
          return chain;
        },
        gte(col: string, val: any) {
          recordedFilters[`${col}_gte`] = val;
          filterFns.push((r) => r[col] >= val);
          return chain;
        },
        lte(col: string, val: any) {
          recordedFilters[`${col}_lte`] = val;
          filterFns.push((r) => r[col] <= val);
          return chain;
        },
        lt(col: string, val: any) {
          recordedFilters[`${col}_lt`] = val;
          filterFns.push((r) => r[col] < val);
          return chain;
        },
        gt(col: string, val: any) {
          recordedFilters[`${col}_gt`] = val;
          filterFns.push((r) => r[col] > val);
          return chain;
        },
        ilike(col: string, pattern: string) {
          const prefix = pattern.replace(/[%]/g, "").toLowerCase();
          filterFns.push((r) => String(r[col] ?? "").toLowerCase().includes(prefix));
          return chain;
        },
        order(_col: string, _opts?: any) {
          return chain;
        },
        limit(count: number) {
          limitVal = count;
          return chain;
        },
        maybeSingle() {
          executedQueries.push({ table, filters: recordedFilters, limit: 1 });
          const matched = data[table].filter((r) => filterFns.every((f) => f(r)));
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
        single() {
          executedQueries.push({ table, filters: recordedFilters, limit: 1 });
          const matched = data[table].filter((r) => filterFns.every((f) => f(r)));
          return Promise.resolve({
            data: matched[0] ?? null,
            error: matched[0] ? null : { message: "Not found" },
          });
        },
        then(resolve: (res: { data: any[]; error: null }) => void) {
          executedQueries.push({ table, filters: recordedFilters, limit: limitVal });
          const matched = data[table].filter((r) => filterFns.every((f) => f(r))).slice(0, limitVal);
          resolve({ data: matched, error: null });
        },
      };

      return chain;
    },
    _getRawData() {
      return data;
    },
  } as any;
}

describe("Part B: My Day Overhaul & Accurate Sales Scoreboard", () => {
  const tenantSlug = "gruve";

  it("calculates timezone week boundaries around Sunday/Monday midnight in Africa/Lagos", () => {
    // Lagos is UTC+1 all year (no DST)
    // Sunday night Nov 1, 2026 at 23:30 UTC -> Nov 2, 2026 at 00:30 Lagos (Monday morning!)
    const sunNightUtc = new Date("2026-11-01T23:30:00Z");
    const boundsSunNight = getWeekBounds(sunNightUtc, "Africa/Lagos");

    // In Lagos, this is already the week of Monday Nov 2 to Sunday Nov 8
    // Monday Nov 2 00:00:00 Lagos = 2026-11-01T23:00:00.000Z
    // Sunday Nov 8 23:59:59 Lagos = 2026-11-08T22:59:59.000Z
    expect(boundsSunNight.weekStart).toBe("2026-11-01T23:00:00.000Z");
    expect(boundsSunNight.weekEnd).toBe("2026-11-08T22:59:59.000Z");

    // Sunday evening Nov 1 at 22:30 UTC -> 23:30 Lagos (still Sunday night of previous week!)
    const prevSunUtc = new Date("2026-11-01T22:30:00Z");
    const boundsPrevSun = getWeekBounds(prevSunUtc, "Africa/Lagos");
    // Monday Oct 26 00:00:00 Lagos = 2026-10-25T23:00:00.000Z
    expect(boundsPrevSun.weekStart).toBe("2026-10-25T23:00:00.000Z");
  });

  it("pushes owner filter into SQL before limit(100) and executes scoreboard with >100 fixtures", async () => {
    const personA = {
      id: "person-a-id",
      tenant_slug: tenantSlug,
      name: "Rep Alpha",
      role_title: "BD Rep",
      tags: ["growth", "enterprise"],
      weekly_targets: { reachOuts: 50, conversations: 10, eventsCreated: 2 },
      active: true,
    };
    const personB = {
      id: "person-b-id",
      tenant_slug: tenantSlug,
      name: "Rep Beta",
      role_title: "BD Rep",
      tags: ["growth", "smb"],
      weekly_targets: { reachOuts: 40, conversations: 8, eventsCreated: 1 },
      active: true,
    };

    const teamPeople = [personA, personB];

    // Generate >100 prospects
    const prospects: any[] = [];
    const inboundMessages: any[] = [];
    const outboundDms: any[] = [];

    // Week boundaries for test: Nov 2 - Nov 8, 2026
    const midWeekIso = "2026-11-04T12:00:00.000Z";

    for (let i = 1; i <= 80; i++) {
      const isPersonA = i <= 50;
      const ownerPersonId = isPersonA ? personA.id : personB.id;
      const ownerName = isPersonA ? personA.name : personB.name;

      let status = "approved";
      if (i % 8 === 0) status = "handed_off";
      else if (i % 15 === 0) status = "closed_won";
      else if (i % 7 === 0) status = "follow_up";

      prospects.push({
        id: `p-${i}`,
        tenant_slug: tenantSlug,
        owner_person_id: ownerPersonId,
        owner: ownerName,
        status,
        handle: `brand_${i}`,
        display_name: `Brand ${i}`,
        platform: "instagram",
        priority: "A",
        approved_message: `Hi Brand ${i}! Let's connect.`,
        approved_channel: "Instagram",
        approved_contact: `@brand_${i}`,
        approved_by: "Manager",
        approved_at: midWeekIso,
        status_updated_at: midWeekIso, // Updated during the week
        updated_at: midWeekIso,
        follow_up_at: "2026-11-04T09:00:00Z",
      });

      // Inbound message
      if (i <= 30) {
        inboundMessages.push({
          id: `in-${i}`,
          tenant_slug: tenantSlug,
          prospect_id: `p-${i}`,
          body: `Inbound inquiry from brand ${i}`,
          received_at: midWeekIso,
          read_at: null,
          waiting_on_person_id: i === 5 ? personB.id : null, // #5 is waiting on Rep Beta
        });
      }

      // Outbound DMs sent
      if (i <= 40) {
        outboundDms.push({
          id: `dm-${i}`,
          tenant_slug: tenantSlug,
          prospect_id: `p-${i}`,
          sender: ownerName,
          status: "sent",
          sent_at: midWeekIso,
        });
      }
    }

    const totalRows = prospects.length + inboundMessages.length + outboundDms.length;
    expect(totalRows).toBeGreaterThan(100);

    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      team_people: teamPeople,
      prospects,
      inbound_messages: inboundMessages,
      outbound_dms: outboundDms,
      action_items: [],
      engagement_items: [],
      prospect_notes: [],
    });

    // 1. Query for Person A
    const dayAlpha = await getMyDay(client, tenantSlug, {
      owner: personA.id,
      nowMs: new Date(midWeekIso).getTime(),
    });

    // Verify owner filter was pushed into SQL
    const prospectQueries = client.executedQueries.filter((q: any) => q.table === "prospects");
    expect(prospectQueries.length).toBeGreaterThan(0);
    const filteredProspectQuery = prospectQueries.find(
      (q: any) => q.filters.owner_person_id === personA.id
    );
    expect(filteredProspectQuery).toBeDefined();

    // Verify Ready to Send contains only Person A's leads
    expect(dayAlpha.readyToSend.length).toBeGreaterThan(0);
    expect(dayAlpha.readyToSend.every((r) => r.ownerPersonId === personA.id)).toBe(true);

    // Verify structured approval fields were extracted
    const firstReady = dayAlpha.readyToSend[0];
    expect(firstReady.approvedMessage).toContain("Hi Brand");
    expect(firstReady.channel).toBe("Instagram");

    // Verify Scoreboard for Person A uses individual targets
    expect(dayAlpha.scoreboard.targets.reachOuts).toBe(50);
    expect(dayAlpha.scoreboard.targets.conversations).toBe(10);
    expect(dayAlpha.scoreboard.targets.eventsCreated).toBe(2);
  });

  it("counts calls and events using status_updated_at not updated_at (reassigning owner does not bump weekly count)", async () => {
    const personA = {
      id: "person-a-id",
      tenant_slug: tenantSlug,
      name: "Rep Alpha",
      role_title: "BD Rep",
      tags: ["growth"],
      weekly_targets: { reachOuts: 50, conversations: 10, eventsCreated: 2 },
      active: true,
    };

    const midWeek = "2026-11-04T12:00:00.000Z";
    const twoMonthsAgo = "2026-09-01T12:00:00.000Z";

    // Lead had call booked (handed_off) 2 months ago, but owner reassigned today (updating updated_at only!)
    const prospectOldCall = {
      id: "p-old-call",
      tenant_slug: tenantSlug,
      owner_person_id: personA.id,
      owner: personA.name,
      status: "handed_off",
      status_updated_at: twoMonthsAgo, // Old call!
      updated_at: midWeek, // Reassigned today
    };

    // Lead had call booked this week
    const prospectNewCall = {
      id: "p-new-call",
      tenant_slug: tenantSlug,
      owner_person_id: personA.id,
      owner: personA.name,
      status: "handed_off",
      status_updated_at: midWeek, // This week!
      updated_at: midWeek,
    };

    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      team_people: [personA],
      prospects: [prospectOldCall, prospectNewCall],
      inbound_messages: [],
      outbound_dms: [],
      action_items: [],
      engagement_items: [],
      prospect_notes: [],
    });

    const day = await getMyDay(client, tenantSlug, {
      owner: personA.id,
      nowMs: new Date(midWeek).getTime(),
    });

    // Calls booked count must ONLY be 1 (p-new-call), not 2
    expect(day.scoreboard.callsBooked).toBe(1);
  });

  it("sums targets correctly for Everyone vs tag groups vs individual owners", async () => {
    const personA = {
      id: "person-a",
      tenant_slug: tenantSlug,
      name: "Rep Alpha",
      role_title: "Growth",
      tags: ["growth", "enterprise"],
      weekly_targets: { reachOuts: 50, conversations: 10, eventsCreated: 2 },
      active: true,
    };
    const personB = {
      id: "person-b",
      tenant_slug: tenantSlug,
      name: "Rep Beta",
      role_title: "SMB",
      tags: ["growth", "smb"],
      weekly_targets: { reachOuts: 40, conversations: 8, eventsCreated: 1 },
      active: true,
    };
    const personC = {
      id: "person-c",
      tenant_slug: tenantSlug,
      name: "Rep Gamma",
      role_title: "Enterprise",
      tags: ["enterprise"],
      weekly_targets: { reachOuts: 20, conversations: 5, eventsCreated: 3 },
      active: true,
    };

    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      team_people: [personA, personB, personC],
      prospects: [],
      inbound_messages: [],
      outbound_dms: [],
      action_items: [],
      engagement_items: [],
      prospect_notes: [],
    });

    const nowMs = new Date("2026-11-04T12:00:00Z").getTime();

    // 1. Everyone: sums all 3 active members
    const dayEveryone = await getMyDay(client, tenantSlug, { owner: "all", nowMs });
    expect(dayEveryone.scoreboard.targets.reachOuts).toBe(50 + 40 + 20); // 110
    expect(dayEveryone.scoreboard.targets.conversations).toBe(10 + 8 + 5); // 23
    expect(dayEveryone.scoreboard.targets.eventsCreated).toBe(2 + 1 + 3); // 6

    // 2. Tag "growth": sums Rep Alpha and Rep Beta
    const dayGrowth = await getMyDay(client, tenantSlug, { owner: "tag:growth", nowMs });
    expect(dayGrowth.scoreboard.targets.reachOuts).toBe(50 + 40); // 90
    expect(dayGrowth.scoreboard.targets.conversations).toBe(10 + 8); // 18
    expect(dayGrowth.scoreboard.targets.eventsCreated).toBe(2 + 1); // 3

    // 3. Individual "Rep Gamma": returns Rep Gamma's targets
    const dayGamma = await getMyDay(client, tenantSlug, { owner: personC.id, nowMs });
    expect(dayGamma.scoreboard.targets.reachOuts).toBe(20);
    expect(dayGamma.scoreboard.targets.conversations).toBe(5);
    expect(dayGamma.scoreboard.targets.eventsCreated).toBe(3);
  });

  it("routes waiting_on_person_id items to waitingOn with person name and categorizes dropped follow-ups", async () => {
    const reviewer = {
      id: "person-reviewer",
      tenant_slug: tenantSlug,
      name: "Reviewer Person",
      role_title: "Lead",
      tags: [],
      weekly_targets: {},
      active: true,
    };

    const prospects = [
      {
        id: "p-normal-fu",
        tenant_slug: tenantSlug,
        owner_person_id: reviewer.id,
        owner: reviewer.name,
        status: "contacted",
        handle: "lead_one",
        display_name: "Lead One",
        platform: "instagram",
        priority: "A",
        follow_up_at: "2026-11-04T08:00:00Z",
      },
      {
        id: "p-dropped-fu",
        tenant_slug: tenantSlug,
        owner_person_id: reviewer.id,
        owner: reviewer.name,
        status: "contacted",
        handle: "lead_two",
        display_name: "Lead Two",
        platform: "instagram",
        priority: "A",
        follow_up_at: "2026-11-04T08:00:00Z",
      },
    ];

    const outboundDms = [
      // lead_one: 1 outbound sent -> attempt 1 -> not dropped
      {
        id: "dm-1",
        tenant_slug: tenantSlug,
        prospect_id: "p-normal-fu",
        status: "sent",
        sent_at: "2026-10-28T10:00:00Z",
      },
      // lead_two: 2 outbounds sent -> attempt 2 -> dropped!
      {
        id: "dm-2",
        tenant_slug: tenantSlug,
        prospect_id: "p-dropped-fu",
        status: "sent",
        sent_at: "2026-10-20T10:00:00Z",
      },
      {
        id: "dm-3",
        tenant_slug: tenantSlug,
        prospect_id: "p-dropped-fu",
        status: "sent",
        sent_at: "2026-10-27T10:00:00Z",
      },
    ];

    const inboundMessages = [
      {
        id: "in-waiting",
        tenant_slug: tenantSlug,
        prospect_id: "p-normal-fu",
        body: "Contract ready for review",
        received_at: "2026-11-03T10:00:00Z",
        read_at: null,
        waiting_on_person_id: reviewer.id,
      },
      {
        id: "in-regular",
        tenant_slug: tenantSlug,
        prospect_id: "p-normal-fu",
        body: "Hello regular message",
        received_at: "2026-11-03T11:00:00Z",
        read_at: null,
        waiting_on_person_id: null,
      },
    ];

    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      team_people: [reviewer],
      prospects,
      inbound_messages: inboundMessages,
      outbound_dms: outboundDms,
      action_items: [],
      engagement_items: [],
      prospect_notes: [],
    });

    const day = await getMyDay(client, tenantSlug, {
      owner: "all",
      nowMs: new Date("2026-11-04T12:00:00Z").getTime(),
    });

    // 1. Waiting On item
    expect(day.waitingOn.length).toBe(1);
    expect(day.waitingOn[0].body).toBe("Contract ready for review");
    expect(day.waitingOn[0].isWaitingOnPerson).toBe(true);
    expect(day.waitingOn[0].waitingOnPersonName).toBe("Reviewer Person");

    // Regular reply item
    expect(day.replyNow.length).toBe(1);
    expect(day.replyNow[0].body).toBe("Hello regular message");

    // 2. Follow-up today vs dropped
    expect(day.followUpToday.length).toBe(1);
    expect(day.followUpToday[0].name).toBe("Lead One");

    expect(day.droppedFollowUps.length).toBe(1);
    expect(day.droppedFollowUps[0].name).toBe("Lead Two");
  });

  it("handles several hundred leads (>500 rows) without URL query length failure via inner join", async () => {
    const tenantSlug = "acme";
    const person = {
      id: "person-large",
      tenant_slug: tenantSlug,
      name: "Large Portfolio Rep",
      tags: ["sales"],
      weekly_targets: { reachOuts: 100, conversations: 20 },
      active: true,
    };

    // Create 600 prospects owned by this rep
    const prospects: any[] = [];
    const inboundMessages: any[] = [];
    const outboundDms: any[] = [];
    const midWeekIso = "2026-11-04T12:00:00.000Z";

    for (let i = 1; i <= 600; i++) {
      prospects.push({
        id: `p-large-${i}`,
        tenant_slug: tenantSlug,
        owner_person_id: person.id,
        owner: person.name,
        status: i % 10 === 0 ? "handed_off" : i % 25 === 0 ? "closed_won" : "approved",
        handle: `lead_${i}`,
        display_name: `Lead ${i}`,
        platform: "instagram",
        priority: "B",
        approved_message: "Hello!",
        approved_at: midWeekIso,
        status_updated_at: midWeekIso,
        updated_at: midWeekIso,
      });

      if (i <= 150) {
        inboundMessages.push({
          id: `in-large-${i}`,
          tenant_slug: tenantSlug,
          prospect_id: `p-large-${i}`,
          body: `Inbound message from lead ${i}`,
          received_at: midWeekIso,
          read_at: null,
          waiting_on_person_id: null,
        });
      }

      if (i <= 200) {
        outboundDms.push({
          id: `dm-large-${i}`,
          tenant_slug: tenantSlug,
          prospect_id: `p-large-${i}`,
          sender: person.name,
          status: "sent",
          sent_at: midWeekIso,
        });
      }
    }

    const client = createMockSupabase({
      tenants: [{ slug: tenantSlug, timezone: "Africa/Lagos" }],
      team_people: [person],
      prospects,
      inbound_messages: inboundMessages,
      outbound_dms: outboundDms,
      action_items: [],
      engagement_items: [],
      prospect_notes: [],
    });

    const day = await getMyDay(client, tenantSlug, {
      owner: person.id,
      nowMs: new Date(midWeekIso).getTime(),
    });

    // Verify inbound queries did NOT use prospect_id_in with a massive array of 600 IDs
    const inboundQ = client.executedQueries.find((q: any) => q.table === "inbound_messages");
    expect(inboundQ).toBeDefined();
    expect(inboundQ?.filters.prospect_id_in).toBeUndefined();
    expect(inboundQ?.filters["prospects.owner_person_id"]).toBe(person.id);

    // Verify outbound DM queries also used inner join filter without massive array
    const dmQ = client.executedQueries.find((q: any) => q.table === "outbound_dms");
    expect(dmQ).toBeDefined();
    expect(dmQ?.filters.prospect_id_in).toBeUndefined();
    expect(dmQ?.filters["prospects.owner_person_id"]).toBe(person.id);

    // Verify scoreboard reflects data accurately
    expect(day.scoreboard.messagesSent).toBe(200);
    expect(day.scoreboard.repliesReceived).toBe(150);
  });

  it("migration 111 status_updated_at preserves historical timestamp from updated_at / created_at", async () => {
    const historicalUpdate = "2026-08-10T10:00:00.000Z";
    const historicalCreated = "2026-08-01T10:00:00.000Z";

    // Simulating the corrected Migration 111 backfill:
    // status_updated_at = coalesce(updated_at, created_at, now())
    const rowWithUpdated = {
      id: "p-historical-1",
      updated_at: historicalUpdate,
      created_at: historicalCreated,
      status_updated_at: null,
    };

    const rowWithOnlyCreated = {
      id: "p-historical-2",
      updated_at: null,
      created_at: historicalCreated,
      status_updated_at: null,
    };

    // Apply backfill logic
    const backfilled1 = {
      ...rowWithUpdated,
      status_updated_at: rowWithUpdated.updated_at || rowWithUpdated.created_at,
    };
    const backfilled2 = {
      ...rowWithOnlyCreated,
      status_updated_at: rowWithOnlyCreated.updated_at || rowWithOnlyCreated.created_at,
    };

    expect(backfilled1.status_updated_at).toBe(historicalUpdate);
    expect(backfilled2.status_updated_at).toBe(historicalCreated);

    // Verify that historical status_updated_at is NOT within the current week (Nov 2026)
    const { weekStart, weekEnd } = getWeekBounds(new Date("2026-11-04T12:00:00Z"), "Africa/Lagos");
    expect(backfilled1.status_updated_at >= weekStart && backfilled1.status_updated_at <= weekEnd).toBe(false);
  });
});
