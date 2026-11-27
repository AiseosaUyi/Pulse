import { describe, it, expect, vi, beforeEach } from "vitest";

const analyze = vi.fn(async () => undefined);
vi.mock("@/lib/services/outreach-intelligence", () => ({
  analyzeConversationSystem: (...args: unknown[]) => analyze(...(args as [])),
}));

import { FakeDb, fakeClient } from "../helpers/fake-db";
import {
  findProspectForInbound,
  phoneKey,
  pickProspectMatch,
  type ProspectCandidate,
} from "@/lib/outbound/match-prospect";
import { linkInboundToProspect } from "@/lib/services/prospect-inbound-link";

const T = "sippy";
const OTHER = "gruve";

function prospect(over: Partial<ProspectCandidate> & Record<string, unknown>) {
  return {
    tenant_slug: T,
    platform: "instagram",
    handle: null,
    phone: null,
    duplicate_of_id: null,
    status: "sent",
    channel_handoff: null,
    ...over,
  };
}

describe("phoneKey", () => {
  it("normalises Nigerian variants to the same E.164 digits", () => {
    const want = "2348031234567";
    expect(phoneKey("08031234567")).toBe(want);
    expect(phoneKey("+2348031234567")).toBe(want);
    expect(phoneKey("2348031234567")).toBe(want);
    expect(phoneKey("+234 803 123 4567")).toBe(want);
    expect(phoneKey("0803-123-4567")).toBe(want);
  });
  it("refuses empty or too-short input", () => {
    expect(phoneKey("")).toBe("");
    expect(phoneKey(null)).toBe("");
    expect(phoneKey("12345")).toBe("");
  });
});

describe("pickProspectMatch (pure)", () => {
  const c = (id: string, over: Partial<ProspectCandidate>): ProspectCandidate => ({
    id,
    platform: "instagram",
    handle: null,
    phone: null,
    ...over,
  });

  it("matches a phone across formats", () => {
    const cands = [c("p1", { phone: "0803 123 4567" }), c("p2", { phone: "+2348099999999" })];
    expect(pickProspectMatch({ channel: "whatsapp", phone: "2348031234567" }, cands)).toBe("p1");
  });
  it("returns null when two prospects share the phone", () => {
    const cands = [c("p1", { phone: "08031234567" }), c("p2", { phone: "+2348031234567" })];
    expect(pickProspectMatch({ channel: "whatsapp", phone: "+2348031234567" }, cands)).toBeNull();
  });
  it("ignores rows marked as a duplicate", () => {
    const cands = [
      c("p1", { phone: "08031234567" }),
      c("p2", { phone: "+2348031234567", duplicate_of_id: "p1" }),
    ];
    expect(pickProspectMatch({ channel: "whatsapp", phone: "08031234567" }, cands)).toBe("p1");
  });
  it("matches a handle ignoring @ and case, on the same platform only", () => {
    const cands = [c("p1", { handle: "@Lagos_Lounge" }), c("p2", { platform: "tiktok", handle: "lagos_lounge" })];
    expect(pickProspectMatch({ channel: "instagram", handle: "lagos_lounge" }, cands)).toBe("p1");
    expect(pickProspectMatch({ channel: "tiktok", handle: "@LAGOS_LOUNGE" }, cands)).toBe("p2");
  });
  it("does not let ilike's _ wildcard produce a false match", () => {
    const cands = [c("p1", { handle: "lagosXlounge" })];
    expect(pickProspectMatch({ channel: "instagram", handle: "lagos_lounge" }, cands)).toBeNull();
  });
  it("returns null with no sender key", () => {
    expect(pickProspectMatch({ channel: "whatsapp", phone: null }, [c("p1", { phone: "08031234567" })])).toBeNull();
    expect(pickProspectMatch({ channel: "instagram", handle: "@" }, [c("p1", { handle: "x" })])).toBeNull();
  });
});

describe("findProspectForInbound (fake db)", () => {
  it("finds the prospect by phone within the tenant", async () => {
    const db = new FakeDb({ prospects: [prospect({ id: "p1", phone: "0803 123 4567" })] });
    expect(await findProspectForInbound(fakeClient(db), T, { channel: "whatsapp", phone: "2348031234567" })).toBe("p1");
  });
  it("never matches a prospect from another tenant", async () => {
    const db = new FakeDb({ prospects: [prospect({ id: "p1", tenant_slug: OTHER, phone: "08031234567" })] });
    expect(await findProspectForInbound(fakeClient(db), T, { channel: "whatsapp", phone: "08031234567" })).toBeNull();
  });
  it("only the tenant's own prospect counts when another tenant shares the number", async () => {
    const db = new FakeDb({
      prospects: [
        prospect({ id: "mine", phone: "08031234567" }),
        prospect({ id: "theirs", tenant_slug: OTHER, phone: "08031234567" }),
      ],
    });
    expect(await findProspectForInbound(fakeClient(db), T, { channel: "whatsapp", phone: "+2348031234567" })).toBe("mine");
  });
  it("finds by handle with @ and different case", async () => {
    const db = new FakeDb({ prospects: [prospect({ id: "p1", handle: "@Lagos_Lounge" })] });
    expect(await findProspectForInbound(fakeClient(db), T, { channel: "instagram", handle: "lagos_lounge" })).toBe("p1");
  });
  it("returns null when ambiguous", async () => {
    const db = new FakeDb({
      prospects: [prospect({ id: "p1", handle: "lagos_lounge" }), prospect({ id: "p2", handle: "@LAGOS_LOUNGE" })],
    });
    expect(await findProspectForInbound(fakeClient(db), T, { channel: "instagram", handle: "lagos_lounge" })).toBeNull();
  });
  it("returns null with no match", async () => {
    const db = new FakeDb({ prospects: [prospect({ id: "p1", handle: "someone_else" })] });
    expect(await findProspectForInbound(fakeClient(db), T, { channel: "instagram", handle: "lagos_lounge" })).toBeNull();
  });
});

describe("linkInboundToProspect (wiring, fake db)", () => {
  beforeEach(() => analyze.mockClear());

  const waRow = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    tenant_slug: T,
    platform: "whatsapp",
    channel: "whatsapp",
    external_id: "wamid.1",
    body: "Yes please send the price list",
    from_handle: "2348031234567",
    prospect_id: null,
    ...over,
  });
  const waInput = {
    tenantSlug: T,
    channel: "whatsapp" as const,
    platform: "whatsapp",
    externalId: "wamid.1",
    body: "Yes please send the price list",
    receivedAt: "2026-11-27T10:00:00.000Z",
    phone: "2348031234567",
  };

  it("links the existing WhatsApp row (no duplicate), marks replied, cancels follow-ups, analyses", async () => {
    const db = new FakeDb({
      prospects: [prospect({ id: "p1", phone: "08031234567", status: "sent" })],
      inbound_messages: [waRow()],
      outbound_dms: [
        { id: "f1", tenant_slug: T, prospect_id: "p1", kind: "follow_up_1", status: "approved" },
        { id: "f2", tenant_slug: T, prospect_id: "p1", kind: "first", status: "sent" },
      ],
    });
    const res = await linkInboundToProspect(fakeClient(db), waInput);
    expect(res).toMatchObject({ linked: true, prospectId: "p1", inboundMessageId: "m1", statusChanged: true });
    expect(db.rows("inbound_messages")).toHaveLength(1);
    expect(db.rows("inbound_messages")[0].prospect_id).toBe("p1");
    expect(db.rows("prospects")[0].status).toBe("replied");
    expect(db.rows("outbound_dms").find((d) => d.id === "f1")!.status).toBe("cancelled");
    expect(db.rows("outbound_dms").find((d) => d.id === "f2")!.status).toBe("sent");
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second delivery of the same message does nothing", async () => {
    const db = new FakeDb({
      prospects: [prospect({ id: "p1", phone: "08031234567" })],
      inbound_messages: [waRow()],
    });
    await linkInboundToProspect(fakeClient(db), waInput);
    const again = await linkInboundToProspect(fakeClient(db), waInput);
    expect(again).toEqual({ linked: false, reason: "already_linked" });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("leaves unmatched messages exactly as they were", async () => {
    const db = new FakeDb({
      prospects: [prospect({ id: "p1", phone: "08099999999" })],
      inbound_messages: [waRow()],
    });
    const res = await linkInboundToProspect(fakeClient(db), waInput);
    expect(res).toEqual({ linked: false, reason: "no_match" });
    expect(db.rows("inbound_messages")[0].prospect_id).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("never downgrades closed / won statuses", async () => {
    for (const status of ["closed_won", "closed_lost", "handed_off", "dismissed", "unqualified"]) {
      const db = new FakeDb({
        prospects: [prospect({ id: "p1", phone: "08031234567", status })],
        inbound_messages: [waRow()],
      });
      const res = await linkInboundToProspect(fakeClient(db), waInput);
      expect(res).toMatchObject({ linked: true, statusChanged: false });
      expect(db.rows("prospects")[0].status).toBe(status);
    }
  });

  it("respects a channel handoff (status untouched, still linked)", async () => {
    const db = new FakeDb({
      prospects: [prospect({ id: "p1", phone: "08031234567", status: "sent", channel_handoff: "phone" })],
      inbound_messages: [waRow()],
    });
    const res = await linkInboundToProspect(fakeClient(db), waInput);
    expect(res).toMatchObject({ linked: true, statusChanged: false });
    expect(db.rows("prospects")[0].status).toBe("sent");
    expect(db.rows("inbound_messages")[0].prospect_id).toBe("p1");
  });

  it("creates the prospect-linked row for an Instagram DM (stored elsewhere for Conversations)", async () => {
    const db = new FakeDb({ prospects: [prospect({ id: "p1", handle: "@Lagos_Lounge", status: "sent" })] });
    const input = {
      tenantSlug: T,
      channel: "instagram" as const,
      platform: "instagram",
      externalId: "ig.1",
      body: "How much for 10 cartons?",
      receivedAt: "2026-11-27T10:00:00.000Z",
      handle: "lagos_lounge",
    };
    const res = await linkInboundToProspect(fakeClient(db), input);
    expect(res).toMatchObject({ linked: true, prospectId: "p1" });
    expect(db.rows("inbound_messages")).toHaveLength(1);
    expect(db.rows("inbound_messages")[0]).toMatchObject({ prospect_id: "p1", external_id: "ig.1", platform: "instagram" });
    expect(db.rows("prospects")[0].status).toBe("replied");

    const again = await linkInboundToProspect(fakeClient(db), input);
    expect(again).toEqual({ linked: false, reason: "already_linked" });
    expect(db.rows("inbound_messages")).toHaveLength(1);
  });

  it("does not link across tenants", async () => {
    const db = new FakeDb({
      prospects: [prospect({ id: "p1", tenant_slug: OTHER, phone: "08031234567" })],
      inbound_messages: [waRow()],
    });
    const res = await linkInboundToProspect(fakeClient(db), waInput);
    expect(res).toEqual({ linked: false, reason: "no_match" });
    expect(db.rows("prospects")[0].status).toBe("sent");
  });
});
