import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, fakeClient } from "../helpers/fake-db";

const findEmailsForTenant = vi.fn();
vi.mock("@/lib/outreach-autopilot/enrich", () => ({
  findEmailsForTenant: (...args: unknown[]) => findEmailsForTenant(...args),
}));

import { findEmailsForAllTenants } from "@/lib/outreach-autopilot/find-emails-job";

const opts = () => ({ deadlineMs: Date.now() + 60_000, perTenantLimit: 60, perTenantSearchBudget: 30 });

describe("find-lead-emails job", () => {
  beforeEach(() => {
    findEmailsForTenant.mockReset();
    findEmailsForTenant.mockResolvedValue({ checked: 3, found: 1, searches: 2 });
  });

  it("searches every workspace that has no mailbox", async () => {
    const db = new FakeDb({ tenants: [{ slug: "sippy", settings: {} }, { slug: "gruve", settings: null }] });
    const res = await findEmailsForAllTenants(fakeClient(db), opts());
    expect(findEmailsForTenant.mock.calls.map((c) => c[1])).toEqual(["sippy", "gruve"]);
    expect(findEmailsForTenant.mock.calls[0][2]).toMatchObject({ limit: 60, searchBudget: 30 });
    expect(res.map((r) => [r.tenantSlug, r.found])).toEqual([
      ["sippy", 1],
      ["gruve", 1],
    ]);
  });

  it("skips a workspace the Autopilot runner already covers, but not a paused or no-compose mailbox", async () => {
    const db = new FakeDb({
      tenants: [{ slug: "a" }, { slug: "b" }, { slug: "c" }],
      outreach_mailboxes: [
        { tenant_slug: "a", enabled: true, auto_compose: true },
        { tenant_slug: "b", enabled: false, auto_compose: true },
        { tenant_slug: "c", enabled: true, auto_compose: false },
      ],
    });
    const res = await findEmailsForAllTenants(fakeClient(db), opts());
    expect(findEmailsForTenant.mock.calls.map((c) => c[1])).toEqual(["b", "c"]);
    expect(res.find((r) => r.tenantSlug === "a")?.skipped).toBe("runner_handles");
  });

  it("skips a workspace that switched the autopilot feature off", async () => {
    const db = new FakeDb({
      tenants: [
        { slug: "off", settings: { features: { autopilot: false } } },
        { slug: "on", settings: { features: { autopilot: true } } },
      ],
    });
    const res = await findEmailsForAllTenants(fakeClient(db), opts());
    expect(findEmailsForTenant.mock.calls.map((c) => c[1])).toEqual(["on"]);
    expect(res[0].skipped).toBe("feature_off");
  });

  it("keeps going when one workspace fails", async () => {
    findEmailsForTenant.mockRejectedValueOnce(new Error("boom"));
    const db = new FakeDb({ tenants: [{ slug: "bad" }, { slug: "good" }] });
    const res = await findEmailsForAllTenants(fakeClient(db), opts());
    expect(res[0]).toMatchObject({ tenantSlug: "bad", error: "boom", found: 0 });
    expect(res[1]).toMatchObject({ tenantSlug: "good", found: 1 });
  });

  it("starts no new workspace after the deadline", async () => {
    const db = new FakeDb({ tenants: [{ slug: "late" }] });
    const res = await findEmailsForAllTenants(fakeClient(db), { ...opts(), deadlineMs: Date.now() - 1 });
    expect(findEmailsForTenant).not.toHaveBeenCalled();
    expect(res[0].skipped).toBe("out_of_time");
  });
});
