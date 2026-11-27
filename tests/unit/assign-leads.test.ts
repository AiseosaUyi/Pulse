import { describe, it, expect } from "vitest";
import { FakeDb, fakeClient } from "../helpers/fake-db";
import { assignNewLeads, readLeadAssignment } from "@/lib/outbound/assign-leads";

const T = "acme";
function seed(prospects: Array<Record<string, unknown>>) {
  return new FakeDb({
    memberships: [
      { tenant_slug: T, user_id: "u1", role: "owner" },
      { tenant_slug: T, user_id: "u2", role: "member" },
      { tenant_slug: T, user_id: "u3", role: "support" },
    ],
    team_people: [
      { id: "p1", tenant_slug: T, name: "Ada", user_id: "u1", active: true },
      { id: "p2", tenant_slug: T, name: "Bola", user_id: "u2", active: true },
      { id: "p3", tenant_slug: T, name: "Support", user_id: "u3", active: true },
      { id: "p4", tenant_slug: T, name: "Ambassador 1", user_id: null, active: true },
    ],
    prospects: prospects.map((p, i) => ({
      tenant_slug: T, owner_person_id: null, status: "new", quality: "unscored", duplicate_of_id: null,
      created_at: `2026-11-${String(10 + i).padStart(2, "0")}T00:00:00Z`, ...p,
    })),
  });
}
const owners = (db: FakeDb) => Object.fromEntries(db.rows("prospects").map((p) => [p.id, p.owner_person_id ?? null]));

describe("share new leads", () => {
  it("gives leads only to teammates with a login (not support, not roster-only), evenly", async () => {
    const db = seed([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
    const r = await assignNewLeads(fakeClient(db), T, { perPersonPerDay: 5 });
    expect(r).toEqual({ assigned: 4, people: 2 });
    const o = Object.values(owners(db));
    expect(o.filter((x) => x === "p1")).toHaveLength(2);
    expect(o.filter((x) => x === "p2")).toHaveLength(2);
    expect(db.rows("prospects").find((p) => p.id === "a")!.owner).toMatch(/Ada|Bola/);
  });

  it("best leads first, respects the daily number, skips dead, duplicates and closed", async () => {
    const db = seed([
      { id: "new1" },
      { id: "replied", status: "replied" },
      { id: "hot", quality: "hot" },
      { id: "dead", quality: "dead" },
      { id: "dupe", duplicate_of_id: "x" },
      { id: "lost", status: "closed_lost" },
    ]);
    const r = await assignNewLeads(fakeClient(db), T, { perPersonPerDay: 1 });
    expect(r.assigned).toBe(2);
    const o = owners(db);
    expect(o.replied).not.toBeNull();
    expect(o.hot).not.toBeNull();
    expect([o.new1, o.dead, o.dupe, o.lost]).toEqual([null, null, null, null]);
  });

  it("whoever has fewer open leads gets the next one; owned leads are never moved", async () => {
    const db = seed([
      { id: "mine1", owner_person_id: "p1", status: "sent" },
      { id: "mine2", owner_person_id: "p1", status: "sent" },
      { id: "free" },
    ]);
    await assignNewLeads(fakeClient(db), T, { perPersonPerDay: 5 });
    const o = owners(db);
    expect(o.free).toBe("p2");
    expect([o.mine1, o.mine2]).toEqual(["p1", "p1"]);
  });

  it("config defaults to off and clamps the daily number", () => {
    expect(readLeadAssignment(null)).toEqual({ enabled: false, perPersonPerDay: 15 });
    expect(readLeadAssignment({ leadAssignment: { enabled: true, perPersonPerDay: 999 } })).toEqual({ enabled: true, perPersonPerDay: 100 });
  });
});
