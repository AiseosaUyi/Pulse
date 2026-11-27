import { describe, it, expect, vi, beforeEach } from "vitest";

// Approval emails go through Brevo; capture them, never send.
const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
let failFor: string | null = null;
vi.mock("@/lib/integrations/brevo", () => ({
  getAppBaseUrl: () => "https://pulse.test",
  sendBrevoEmail: vi.fn(async (input: { to: { email: string }; subject: string; textContent: string; htmlContent: string }) => {
    if (failFor && input.to.email === failFor) return { ok: false, error: "boom" };
    sent.push({ to: input.to.email, subject: input.subject, text: input.textContent, html: input.htmlContent });
    return { ok: true, messageId: "m" };
  }),
}));

let currentDb: unknown = null;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => currentDb }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentTenant: vi.fn(async () => null), getCurrentUser: vi.fn(async () => null) }));

import { FakeDb, fakeClient } from "../helpers/fake-db";
import { resolveApprovers, groupByApprover, type AuthEmailLookup } from "@/lib/outreach-autopilot/approvers";
import { sendDigestForTenant, resolveDigest } from "@/lib/outreach-autopilot/digest";
import { sendReplyAlerts } from "@/lib/outreach-autopilot/reply-alerts";
import { decideFromDigest } from "@/lib/actions/outreach-autopilot";
import type { MailboxConfig } from "@/lib/outreach-autopilot/mailbox";
import type { ReplyDraftOutcome } from "@/lib/outreach-autopilot/reply-draft";

const T = "sippy";
const WORKSPACE = "boss@sippy.life";
const NOW = new Date("2026-11-27T07:00:00Z");
const mailbox = { tenantSlug: T, approverEmail: WORKSPACE } as unknown as MailboxConfig;

const authEmails: Record<string, string> = { "u-noemail": "kemi.auth@sippy.life" };
const lookup: AuthEmailLookup = async (id) => authEmails[id] ?? null;

function seed() {
  return new FakeDb({
    prospects: [
      { id: "p-ada", tenant_slug: T, owner_person_id: "tp-ada" }, // owner with login + email
      { id: "p-kemi", tenant_slug: T, owner_person_id: "tp-kemi" }, // owner with login, auth email only
      { id: "p-nologin", tenant_slug: T, owner_person_id: "tp-nologin" }, // owner without login
      { id: "p-support", tenant_slug: T, owner_person_id: "tp-support" }, // support role
      { id: "p-inactive", tenant_slug: T, owner_person_id: "tp-inactive" }, // inactive person
      { id: "p-none", tenant_slug: T, owner_person_id: null }, // unowned
      { id: "p-other", tenant_slug: "gruve", owner_person_id: "tp-ada" }, // other tenant
    ],
    team_people: [
      { id: "tp-ada", tenant_slug: T, user_id: "u-ada", email: "Ada@Sippy.life", active: true },
      { id: "tp-kemi", tenant_slug: T, user_id: "u-noemail", email: null, active: true },
      { id: "tp-nologin", tenant_slug: T, user_id: null, email: "nologin@sippy.life", active: true },
      { id: "tp-support", tenant_slug: T, user_id: "u-support", email: "support@sippy.life", active: true },
      { id: "tp-inactive", tenant_slug: T, user_id: "u-gone", email: "gone@sippy.life", active: false },
    ],
    memberships: [
      { user_id: "u-ada", tenant_slug: T, role: "member" },
      { user_id: "u-noemail", tenant_slug: T, role: "admin" },
      { user_id: "u-support", tenant_slug: T, role: "support" },
      { user_id: "u-gone", tenant_slug: T, role: "member" },
    ],
    outreach_digests: [],
  });
}

function draft(id: string, prospectId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    tenant_slug: T,
    prospect_id: prospectId,
    kind: "cold_open",
    subject: `Hello ${prospectId}`,
    body: "Hi there,\nA line about you.\n\nSippy",
    to_email: `${prospectId}@lead.com`,
    status: "drafted",
    created_at: `2026-11-26T08:00:0${id.slice(-1)}.000Z`,
    updated_at: "2026-11-26T08:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  sent.length = 0;
  failFor = null;
  process.env.APPROVAL_TOKEN_SECRET = "test-secret-at-least-32-characters-long!!";
});

describe("approver resolution", () => {
  it("routes each lead to its owner, or to the workspace approver", async () => {
    const db = seed();
    const map = await resolveApprovers(
      fakeClient(db),
      T,
      ["p-ada", "p-kemi", "p-nologin", "p-support", "p-inactive", "p-none", "p-other", "p-missing"],
      WORKSPACE,
      lookup
    );
    expect(map.get("p-ada")).toEqual({ email: "ada@sippy.life", userId: "u-ada", isOwner: true });
    expect(map.get("p-kemi")).toEqual({ email: "kemi.auth@sippy.life", userId: "u-noemail", isOwner: true });
    for (const id of ["p-nologin", "p-support", "p-inactive", "p-none", "p-other", "p-missing"]) {
      expect(map.get(id), id).toEqual({ email: WORKSPACE, userId: null, isOwner: false });
    }
  });

  it("an owner who is no longer a member falls back", async () => {
    const db = seed();
    db.tables.memberships = db.rows("memberships").filter((m) => m.user_id !== "u-ada");
    const map = await resolveApprovers(fakeClient(db), T, ["p-ada"], WORKSPACE, lookup);
    expect(map.get("p-ada")?.email).toBe(WORKSPACE);
  });

  it("an owner with no email anywhere falls back", async () => {
    const db = seed();
    const map = await resolveApprovers(fakeClient(db), T, ["p-kemi"], WORKSPACE, async () => null);
    expect(map.get("p-kemi")?.email).toBe(WORKSPACE);
  });

  it("an owner who is also the workspace approver gets one group", () => {
    const map = new Map([
      ["a", { email: WORKSPACE, userId: "u-boss", isOwner: true }],
      ["b", { email: WORKSPACE, userId: null, isOwner: false }],
    ]);
    const groups = groupByApprover(["b", "a"], (x) => x, map, WORKSPACE);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual(["b", "a"]);
    expect(groups[0].approver.userId).toBe("u-boss");
  });
});

describe("daily digest split", () => {
  it("one email per approver, each link scoped to only their drafts", async () => {
    const db = seed();
    db.tables.outbound_dms = [
      draft("d1", "p-ada"),
      draft("d2", "p-none"),
      draft("d3", "p-ada", { kind: "follow_up_1" }),
      draft("d4", "p-support"),
      draft("d5", "p-kemi"),
    ];
    const admin = fakeClient(db);
    const r = await sendDigestForTenant(admin, mailbox, "Sippy", NOW, lookup);
    expect(r).toEqual({ sent: true, drafts: 5, emails: 3 });

    const digests = db.rows("outreach_digests");
    const scope = Object.fromEntries(digests.map((d) => [d.sent_to as string, d.dm_ids]));
    expect(scope).toEqual({
      "ada@sippy.life": ["d1", "d3"],
      [WORKSPACE]: ["d2", "d4"],
      "kemi.auth@sippy.life": ["d5"],
    });

    expect(sent.map((s) => s.to).sort()).toEqual(["ada@sippy.life", WORKSPACE, "kemi.auth@sippy.life"].sort());
    const boss = sent.find((s) => s.to === WORKSPACE)!;
    expect(boss.subject).toBe("Sippy: 2 emails ready for your OK");
    expect(boss.text).toContain("3 drafts went to their lead owners.");
    const ada = sent.find((s) => s.to === "ada@sippy.life")!;
    expect(ada.subject).toBe("Sippy: 2 emails ready for your OK");
    expect(ada.text).not.toContain("lead owners");
    expect(ada.text).not.toContain("Sent yesterday");
    for (const s of sent) expect(s.text + s.html).not.toMatch(/[—–]/);

    // Each link resolves to exactly its own drafts, and the owner's carries their user id.
    const adaToken = /approve\/outreach\/([^\s"]+)/.exec(ada.text)![1];
    const resolved = await resolveDigest(admin, adaToken);
    expect(resolved).toEqual({
      ok: true,
      digest: { tenantSlug: T, dmIds: ["d1", "d3"], sentTo: "ada@sippy.life", approverUserId: "u-ada" },
    });
  });

  it("the workspace approver still hears about drafts that all went to owners", async () => {
    const db = seed();
    db.tables.outbound_dms = [draft("d1", "p-ada")];
    const r = await sendDigestForTenant(fakeClient(db), mailbox, "Sippy", NOW, lookup);
    expect(r.emails).toBe(2);
    const boss = sent.find((s) => s.to === WORKSPACE)!;
    expect(boss.subject).toBe("Sippy: outreach update");
    expect(boss.text).toContain("1 draft went to its lead owner.");
    expect(boss.html).not.toContain("Review and approve");
    expect(db.rows("outreach_digests").map((d) => d.sent_to)).toEqual(["ada@sippy.life"]);
  });

  it("stays quiet with nothing to approve or report", async () => {
    const db = seed();
    const r = await sendDigestForTenant(fakeClient(db), mailbox, "Sippy", NOW, lookup);
    expect(r).toEqual({ sent: false, drafts: 0, emails: 0 });
    expect(sent).toHaveLength(0);
  });

  it("a partial send failure is a warning (no retry, no double email); total failure is an error", async () => {
    const db = seed();
    db.tables.outbound_dms = [draft("d1", "p-ada"), draft("d2", "p-none")];
    failFor = "ada@sippy.life";
    const r = await sendDigestForTenant(fakeClient(db), mailbox, "Sippy", NOW, lookup);
    expect(r.sent).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.warnings?.[0]).toContain("ada@sippy.life");

    const db2 = seed();
    db2.tables.outbound_dms = [draft("d2", "p-none")];
    failFor = WORKSPACE;
    const r2 = await sendDigestForTenant(fakeClient(db2), mailbox, "Sippy", NOW, lookup);
    expect(r2.sent).toBe(false);
    expect(r2.error).toBeTruthy();
  });
});

describe("reply alert split", () => {
  const ev = (prospectId: string) => ({ prospectId, from: `${prospectId}@lead.com`, subject: "Re: hi", snippet: "Tell me more", optOut: false });
  const out = (prospectId: string, dmId: string | null): ReplyDraftOutcome => ({
    event: ev(prospectId),
    company: `${prospectId} Ltd`,
    intent: "interested",
    dmId,
    draft: dmId ? "Hi, thanks for the reply." : null,
  });

  it("each owner gets their replies and a link scoped to their answers", async () => {
    const db = seed();
    const admin = fakeClient(db);
    const r = await sendReplyAlerts(
      admin,
      mailbox,
      "Sippy",
      [ev("p-ada"), ev("p-none"), ev("p-ada")],
      [out("p-ada", "r1"), out("p-none", "r2")],
      NOW,
      lookup
    );
    expect(r).toEqual({ emails: 2, errors: [] });
    const scope = Object.fromEntries(db.rows("outreach_digests").map((d) => [d.sent_to as string, d.dm_ids]));
    expect(scope).toEqual({ "ada@sippy.life": ["r1"], [WORKSPACE]: ["r2"] });

    const ada = sent.find((s) => s.to === "ada@sippy.life")!;
    expect(ada.subject).toBe("Sippy: 1 new reply, 1 answer ready");
    expect(ada.text).toContain("p-ada@lead.com");
    expect(ada.text).not.toContain("p-none@lead.com");
    const boss = sent.find((s) => s.to === WORKSPACE)!;
    expect(boss.text).toContain("p-none@lead.com");
    expect(boss.text).not.toContain("p-ada@lead.com");
    expect(boss.text).toContain("1 reply went to its lead owner.");
  });

  it("only owner replies: the workspace approver gets a short heads-up with no link", async () => {
    const db = seed();
    await sendReplyAlerts(fakeClient(db), mailbox, "Sippy", [ev("p-ada")], [out("p-ada", "r1")], NOW, lookup);
    const boss = sent.find((s) => s.to === WORKSPACE)!;
    expect(boss.subject).toBe("Sippy: 1 reply went to its lead owner");
    expect(boss.text).not.toContain("approve/outreach");
    expect(db.rows("outreach_digests")).toHaveLength(1);
  });

  it("only unowned replies: one email to the workspace approver, as before", async () => {
    const db = seed();
    await sendReplyAlerts(fakeClient(db), mailbox, "Sippy", [ev("p-none")], [out("p-none", "r2")], NOW, lookup);
    expect(sent.map((s) => s.to)).toEqual([WORKSPACE]);
    expect(sent[0].text).not.toContain("lead owner");
  });
});

describe("approving from an owner's link", () => {
  async function ownerLink(db: FakeDb) {
    db.tables.outbound_dms = [draft("d1", "p-ada"), draft("d2", "p-none")];
    await sendDigestForTenant(fakeClient(db), mailbox, "Sippy", NOW, lookup);
    const ada = sent.find((s) => s.to === "ada@sippy.life")!;
    return /approve\/outreach\/([^\s"]+)/.exec(ada.text)![1];
  }

  it("records the owner as approver and cannot touch drafts outside the link", async () => {
    const db = seed();
    currentDb = fakeClient(db);
    const token = await ownerLink(db);

    const outside = await decideFromDigest(token, { dmId: "00000000-0000-4000-8000-000000000002", action: "approve", expectedUpdatedAt: "2026-11-26T08:00:00.000Z" });
    expect(outside.ok).toBe(false);

    // decideSchema needs uuids: give the owner's draft a uuid id and rescope the link.
    const uuid = "00000000-0000-4000-8000-000000000001";
    db.rows("outbound_dms").find((d) => d.id === "d1")!.id = uuid;
    const dg = db.rows("outreach_digests").find((d) => d.sent_to === "ada@sippy.life")!;
    dg.dm_ids = [uuid];
    const row = db.rows("outbound_dms").find((d) => d.id === uuid)!;

    const ok = await decideFromDigest(token, { dmId: uuid, action: "approve", expectedUpdatedAt: row.updated_at as string });
    expect(ok.ok).toBe(true);
    expect(row.status).toBe("approved");
    expect(row.send_via).toBe("mailbox");
    expect(row.approved_via).toBe("email_digest");
    expect(row.approved_by).toBe("u-ada");
    // The other draft is untouched.
    expect(db.rows("outbound_dms").find((d) => d.id === "d2")!.status).toBe("drafted");
  });

  it("stops working once the owner leaves the workspace", async () => {
    const db = seed();
    currentDb = fakeClient(db);
    const token = await ownerLink(db);
    db.tables.memberships = db.rows("memberships").filter((m) => m.user_id !== "u-ada");
    expect((await resolveDigest(fakeClient(db), token)).ok).toBe(false);
  });

  it("the workspace approver's link records no user, as before", async () => {
    const db = seed();
    currentDb = fakeClient(db);
    await ownerLink(db);
    const boss = sent.find((s) => s.to === WORKSPACE)!;
    const token = /approve\/outreach\/([^\s"]+)/.exec(boss.text)![1];
    const r = await resolveDigest(fakeClient(db), token);
    expect(r.ok && r.digest.approverUserId).toBe(null);
  });
});
