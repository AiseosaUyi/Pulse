import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyMock = vi.fn();
vi.mock("@/lib/outbound/email-evidence", async (orig) => {
  const real = await orig<typeof import("@/lib/outbound/email-evidence")>();
  return { ...real, verifyEmailEvidence: (...a: unknown[]) => verifyMock(...a) };
});
vi.mock("@/lib/services/outreach-composition", () => ({
  getOutreachConfig: async () => ({ defaultSegment: "organisers", segments: { organisers: {}, venues: {} } }),
}));

import { upsertProspect } from "@/lib/services/outbound";
import { companyDomainFromEmail } from "@/lib/services/outreach-ledger";

type Op = { table: string; op: string; payload?: Record<string, unknown>; filters: Array<[string, unknown]> };

/** Minimal Supabase stand-in: records every write and serves an optional
 * existing prospect row. */
function fakeClient(existing: Record<string, unknown> | null) {
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      const rec: Op = { table, op: "select", filters: [] };
      const b: Record<string, unknown> = {};
      const chain = () => b;
      b.select = () => (rec.op === "select" ? chain() : b);
      b.eq = (c: string, v: unknown) => (rec.filters.push([c, v]), b);
      b.in = chain;
      b.order = chain;
      b.limit = chain;
      b.update = (p: Record<string, unknown>) => ((rec.op = "update"), (rec.payload = p), b);
      b.upsert = (p: Record<string, unknown>) => ((rec.op = "upsert"), (rec.payload = p), b);
      b.insert = (p: Record<string, unknown>) => ((rec.op = "insert"), (rec.payload = p), b);
      const resolve = () => {
        ops.push(rec);
        if (table === "prospects" && rec.op === "select") return { data: existing, error: null };
        if (table === "prospects") return { data: { id: "p1", ...existing, ...rec.payload }, error: null };
        if (table === "outreach_ledger" && rec.op === "insert") return { data: { id: "l1", ...rec.payload }, error: null };
        return { data: null, error: null };
      };
      b.maybeSingle = async () => resolve();
      b.single = async () => resolve();
      return b;
    },
  };
  return { client: client as never, ops };
}

const writes = (ops: Op[]) => ops.filter((o) => o.table === "prospects" && o.op !== "select");
const ledgerInserts = (ops: Op[]) => ops.filter((o) => o.table === "outreach_ledger" && o.op === "insert");

beforeEach(() => verifyMock.mockReset());

describe("upsertProspect: dropped emails (H1)", () => {
  it("ledgers only the EMAIL key, never the company domain", async () => {
    verifyMock.mockResolvedValue({ status: "NOT_ON_PAGE", verified: false, reason: "x" });
    const { client, ops } = fakeClient(null);
    await upsertProspect(client, "gruve", {
      platform: "instagram",
      handle: "acme",
      website: "https://acme.com",
      email: "info@acme.com",
      emailSourceUrl: "https://acme.com/contact",
    });
    const rows = ledgerInserts(ops).map((o) => o.payload);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key_type: "EMAIL", key: "info@acme.com", kind: "DROPPED" });
  });

  it.each(["PAGE_ERROR", "PAGE_BLOCKED"])("does not ledger transient %s", async (status) => {
    verifyMock.mockResolvedValue({ status, verified: false, reason: "x" });
    const { client, ops } = fakeClient(null);
    await upsertProspect(client, "gruve", {
      platform: "instagram",
      handle: "acme",
      website: "https://acme.com",
      email: "info@acme.com",
      emailSourceUrl: "https://acme.com/contact",
    });
    expect(ledgerInserts(ops)).toHaveLength(0);
  });

  it("never treats a free-mail domain as a company domain", () => {
    expect(companyDomainFromEmail("owner@gmail.com")).toBe("");
    expect(companyDomainFromEmail("owner@acme.com.ng")).toBe("acme.com.ng");
  });
});

describe("upsertProspect: partial updates (H2)", () => {
  it("leaves absent fields and handoff columns untouched on update", async () => {
    const { client, ops } = fakeClient({ id: "p1", email_status: "verified" });
    await upsertProspect(client, "gruve", { platform: "instagram", handle: "acme", bio: "new bio" });
    const [w] = writes(ops);
    expect(w.op).toBe("update");
    for (const col of [
      "email", "email_status", "unverified_email", "website", "company_name", "run_id",
      "segment", "country", "city", "team_size", "flags", "phone",
      "channel_handoff", "handoff_contact", "handoff_at",
    ]) {
      expect(w.payload).not.toHaveProperty(col);
    }
    expect(w.filters).toContainEqual(["tenant_slug", "gruve"]);
  });

  it("does not downgrade a verified email when a later email is unverified", async () => {
    const { client, ops } = fakeClient({ id: "p1", email_status: "verified" });
    await upsertProspect(client, "gruve", { platform: "instagram", handle: "acme", email: "x@acme.com" });
    const [w] = writes(ops);
    expect(w.payload).toMatchObject({ unverified_email: "x@acme.com" });
    expect(w.payload).not.toHaveProperty("email_status");
    expect(w.payload).not.toHaveProperty("email");
  });

  it("stores flags as an array and phone in E.164", async () => {
    const { client, ops } = fakeClient(null);
    await upsertProspect(client, "gruve", {
      platform: "instagram",
      handle: "acme",
      flags: ["hot"],
      phone: "08031234567",
    });
    const [w] = writes(ops);
    expect(w.payload).toMatchObject({ flags: ["hot"], phone: "+2348031234567", segment: "organisers" });
  });
});
