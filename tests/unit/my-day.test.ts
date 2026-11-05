/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect } from "vitest";
import { parseApprovedNote, hasUsableContact, getWeekBounds, getMyDay } from "@/lib/services/my-day";

describe("My Day: Note Parsing & Contact Validation", () => {
  it("parses approved note header, channel, contact, and approved message body", () => {
    const note = `First message, approved by Aise 28 Oct. Sender Abdul. Channel WhatsApp +2348012345678. Ready to send.\n\nHey Queen! Saw your Miss Tourism pageant coming up in Lagos. We'd love to partner with Gruve for seamless ticketing.`;

    const parsed = parseApprovedNote(note);
    expect(parsed.channel).toBe("WhatsApp");
    expect(parsed.contact).toBe("+2348012345678");
    expect(parsed.sender).toBe("Abdul");
    expect(parsed.approvedMessage).toBe(
      "Hey Queen! Saw your Miss Tourism pageant coming up in Lagos. We'd love to partner with Gruve for seamless ticketing."
    );
  });

  it("parses Instagram channel and handle from approved note", () => {
    const note = `First message, approved by Aise 1 Nov. Sender Abas. Channel Instagram DM to @lagos_party_vibes. Reach out today.\n\nHey guys! Loved the footage from last weekend.`;

    const parsed = parseApprovedNote(note);
    expect(parsed.channel).toBe("Instagram");
    expect(parsed.contact).toBe("@lagos_party_vibes");
    expect(parsed.sender).toBe("Abas");
    expect(parsed.approvedMessage).toBe("Hey guys! Loved the footage from last weekend.");
  });

  it("diverts auto-generated or missing handles to Find Contact (section d)", () => {
    // 1. Auto-generated slug starting with dec26-
    const autoGen = hasUsableContact({
      handle: "dec26-lagos-pageant-2024",
      platform: "manual",
      phone: null,
      signalData: {},
    });
    expect(autoGen.usable).toBe(false);

    // 2. Manual platform with no phone/contact
    const manualNoContact = hasUsableContact({
      handle: "organizer_without_phone",
      platform: "manual",
      phone: null,
      signalData: {},
    });
    expect(manualNoContact.usable).toBe(false);

    // 3. Real Instagram handle
    const realIg = hasUsableContact({
      handle: "miss_nigeria_org",
      platform: "instagram",
      phone: null,
      signalData: {},
    });
    expect(realIg.usable).toBe(true);
    expect(realIg.channel).toBe("Instagram");
    expect(realIg.contact).toBe("@miss_nigeria_org");

    // 4. Contact in signalData.public_contact
    const withPublicContact = hasUsableContact({
      handle: "dec26-event",
      platform: "manual",
      phone: null,
      signalData: { public_contact: "WhatsApp: +2348099998888" },
    });
    expect(withPublicContact.usable).toBe(true);
    expect(withPublicContact.channel).toBe("WhatsApp");
    expect(withPublicContact.contact).toBe("WhatsApp: +2348099998888");
  });

  it("calculates Monday to Sunday week bounds correctly", () => {
    // Midweek date: Wednesday, Nov 4, 2026 in UTC
    const wed = new Date("2026-11-04T12:00:00Z");
    const { weekStart, weekEnd } = getWeekBounds(wed, "UTC");

    const start = new Date(weekStart);
    const end = new Date(weekEnd);

    // Monday should be Nov 2
    expect(start.getUTCDay()).toBe(1); // 1 = Monday
    expect(start.toISOString().slice(0, 10)).toBe("2026-11-02");

    // Sunday should be Nov 8
    expect(end.getUTCDay()).toBe(0); // 0 = Sunday
    expect(end.toISOString().slice(0, 10)).toBe("2026-11-08");
  });
});

describe("My Day: Sorting, Owner Filter, & Tenant Isolation", () => {
  function makeMockSupabase(tenantData: Record<string, any[]>) {
    return {
      from(table: string) {
        let currentTenant = "";
        const filters: Array<(row: any) => boolean> = [];
        let limitVal = 100;

        const chain = {
          select(_cols = "*") {
            return chain;
          },
          eq(column: string, value: any) {
            if (column === "tenant_slug") {
              currentTenant = value;
            } else {
              filters.push((r) => r[column] === value);
            }
            return chain;
          },
          in(column: string, values: any[]) {
            filters.push((r) => values.includes(r[column]));
            return chain;
          },
          is(column: string, value: any) {
            filters.push((r) => (value === null ? r[column] == null : r[column] === value));
            return chain;
          },
          not(_col: string, _op: string, _val?: any) {
            return chain;
          },
          or(_clause: string) {
            return chain;
          },
          gte(column: string, value: any) {
            filters.push((r) => r[column] >= value);
            return chain;
          },
          lte(column: string, value: any) {
            filters.push((r) => r[column] <= value);
            return chain;
          },
          lt(column: string, value: any) {
            filters.push((r) => r[column] < value);
            return chain;
          },
          ilike(column: string, pattern: string) {
            const prefix = pattern.replace(/[%]/g, "").toLowerCase();
            filters.push((r) => String(r[column] ?? "").toLowerCase().includes(prefix));
            return chain;
          },
          order(_col: string, _opts?: any) {
            return chain;
          },
          limit(num: number) {
            limitVal = num;
            return chain;
          },
          maybeSingle() {
            const allRows = tenantData[table] ?? [];
            const tenantRows = currentTenant
              ? allRows.filter((r) => r.tenant_slug === currentTenant || r.slug === currentTenant)
              : allRows;
            const filtered = tenantRows.filter((r) => filters.every((f) => f(r)));
            return Promise.resolve({ data: filtered[0] ?? null, error: null });
          },
          single() {
            const allRows = tenantData[table] ?? [];
            const tenantRows = currentTenant
              ? allRows.filter((r) => r.tenant_slug === currentTenant || r.slug === currentTenant)
              : allRows;
            const filtered = tenantRows.filter((r) => filters.every((f) => f(r)));
            return Promise.resolve({
              data: filtered[0] ?? null,
              error: filtered[0] ? null : { message: "Not found" },
            });
          },
          then(resolve: (res: { data: any[]; error: null }) => void) {
            const allRows = tenantData[table] ?? [];
            const tenantRows = currentTenant
              ? allRows.filter((r) => r.tenant_slug === currentTenant || r.slug === currentTenant)
              : allRows;
            const filtered = tenantRows.filter((r) => filters.every((f) => f(r))).slice(0, limitVal);
            resolve({ data: filtered, error: null });
          },
        };
        return chain;
      },
    } as any;
  }

  const mockDbData = {
    tenants: [
      { slug: "gruve", name: "Gruve", timezone: "Africa/Lagos" },
      { slug: "sippy", name: "Sippy", timezone: "Africa/Lagos" },
    ],
    team_people: [
      { id: "person-abdul", tenant_slug: "gruve", name: "Abdul", role_title: "Partnerships", active: true, weekly_targets: {} },
      { id: "person-abas", tenant_slug: "gruve", name: "Abas", role_title: "Marketing", active: true, weekly_targets: {} },
      { id: "person-sarah", tenant_slug: "sippy", name: "Sarah", role_title: "Sales", active: true, weekly_targets: {} },
    ],
    inbound_messages: [
      {
        id: "in-1",
        tenant_slug: "gruve",
        prospect_id: "p-abdul",
        body: "Can we get a demo tomorrow?",
        received_at: "2026-11-01T10:00:00Z", // older
        read_at: null,
      },
      {
        id: "in-2",
        tenant_slug: "gruve",
        prospect_id: "p-abas",
        body: "What is your ticket fee?",
        received_at: "2026-11-03T10:00:00Z", // newer
        read_at: null,
      },
      {
        id: "in-sippy",
        tenant_slug: "sippy",
        prospect_id: "p-sippy",
        body: "Sippy secret inbound",
        received_at: "2026-11-02T10:00:00Z",
        read_at: null,
      },
    ],
    prospects: [
      {
        id: "p-abdul",
        tenant_slug: "gruve",
        handle: "miss_lagos",
        display_name: "Miss Lagos Pageant",
        platform: "instagram",
        status: "approved",
        owner_person_id: "person-abdul",
        owner: "Abdul",
        priority: "A",
        phone: null,
        signal_data: { owner: "Abdul", priority: "A" },
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
      },
      {
        id: "p-abas",
        tenant_slug: "gruve",
        handle: "rave_culture",
        display_name: "Rave Culture Fest",
        platform: "instagram",
        status: "approved",
        owner_person_id: "person-abas",
        owner: "Abas",
        priority: "B",
        phone: null,
        signal_data: { owner: "Abas", priority: "B" },
        created_at: "2026-10-05T00:00:00Z",
        updated_at: "2026-11-02T00:00:00Z",
      },
      {
        id: "p-sippy",
        tenant_slug: "sippy",
        handle: "boba_shop",
        display_name: "Boba Shop",
        platform: "instagram",
        status: "approved",
        owner_person_id: "person-sarah",
        owner: "Sarah",
        priority: "A",
        phone: null,
        signal_data: {},
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
      },
    ],
    engagement_items: [],
    action_items: [],
    prospect_notes: [
      {
        id: "n-1",
        tenant_slug: "gruve",
        prospect_id: "p-abdul",
        body: "First message, approved by Aise 1 Nov. Sender Abdul. Channel Instagram @miss_lagos.\n\nHey Queen! Excited for Miss Lagos.",
        created_at: "2026-11-01T12:00:00Z",
      },
    ],
    outbound_dms: [],
  };

  it("enforces tenant isolation strictly (gruve vs sippy)", async () => {
    const client = makeMockSupabase(mockDbData);

    const gruveDay = await getMyDay(client, "gruve", { owner: "all", nowMs: new Date("2026-11-04T12:00:00Z").getTime() });
    const sippyDay = await getMyDay(client, "sippy", { owner: "all", nowMs: new Date("2026-11-04T12:00:00Z").getTime() });

    // Gruve sees only Gruve leads & messages
    expect(gruveDay.replyNow.some((r) => r.body.includes("Sippy secret inbound"))).toBe(false);
    expect(gruveDay.readyToSend.some((r) => r.name.includes("Boba Shop"))).toBe(false);

    // Sippy sees only Sippy leads & messages
    expect(sippyDay.replyNow.some((r) => r.body.includes("Can we get a demo tomorrow?"))).toBe(false);
    expect(sippyDay.readyToSend.some((r) => r.name.includes("Miss Lagos"))).toBe(false);
    expect(sippyDay.readyToSend.some((r) => r.name.includes("Boba Shop"))).toBe(true);
  });

  it("filters by owner correctly when Abdul is selected", async () => {
    const client = makeMockSupabase(mockDbData);

    const abdulDay = await getMyDay(client, "gruve", { owner: "Abdul", nowMs: new Date("2026-11-04T12:00:00Z").getTime() });

    // Should only see Abdul's items
    expect(abdulDay.owner).toBe("Abdul");
    expect(abdulDay.readyToSend.length).toBe(1);
    expect(abdulDay.readyToSend[0].name).toBe("Miss Lagos Pageant");
    expect(abdulDay.readyToSend[0].owner).toBe("Abdul");

    // Summary line should format with Abdul's name
    expect(abdulDay.summary).toContain("Abdul.");
  });

  it("sorts Reply Now oldest first", async () => {
    const client = makeMockSupabase(mockDbData);

    const gruveDay = await getMyDay(client, "gruve", { owner: "all", nowMs: new Date("2026-11-04T12:00:00Z").getTime() });

    expect(gruveDay.replyNow.length).toBe(2);
    // Nov 1 before Nov 3
    expect(new Date(gruveDay.replyNow[0].receivedAt).getTime()).toBeLessThan(
      new Date(gruveDay.replyNow[1].receivedAt).getTime()
    );
    expect(gruveDay.replyNow[0].body).toBe("Can we get a demo tomorrow?");
  });
});
