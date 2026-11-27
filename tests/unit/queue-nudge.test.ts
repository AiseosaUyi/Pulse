import { describe, it, expect, vi } from "vitest";
import { FakeDb, fakeClient } from "../helpers/fake-db";
import { buildQueueNudgeEmail, escapeHtml, formatAge, queueNudgeSubject } from "@/lib/queue-nudge/email";
import { archiveStaleItems, isStale, selectStaleItems } from "@/lib/queue-nudge/stale";
import {
  listNudgeRecipients,
  runQueueNudgeForTenant,
  summarizeQueue,
  type NudgeRecipient,
  type PersonQueue,
} from "@/lib/queue-nudge/nudge";

const T = "gruve";
const NOW = new Date("2026-11-27T06:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86400000).toISOString();

const EMPTY: PersonQueue = { replies: 0, followUps: 0, decisions: 0, oldest: [] };

function seedTeam() {
  return new FakeDb({
    team_people: [
      { id: "p-owner", tenant_slug: T, name: "Ada", email: "ada@team.test", user_id: "u-owner", active: true },
      { id: "p-member", tenant_slug: T, name: "Bola", email: "bola@team.test", user_id: "u-member", active: true },
      { id: "p-empty", tenant_slug: T, name: "Chi", email: "chi@team.test", user_id: "u-empty", active: true },
      // no login at all
      { id: "p-nologin", tenant_slug: T, name: "Dayo", email: "dayo@team.test", user_id: null, active: true },
      // has a user, but that user is a member of another tenant only
      { id: "p-other", tenant_slug: T, name: "Efe", email: "efe@team.test", user_id: "u-other", active: true },
      // inactive
      { id: "p-gone", tenant_slug: T, name: "Femi", email: "femi@team.test", user_id: "u-gone", active: false },
      // no email on the row; falls back to the auth email
      { id: "p-noemail", tenant_slug: T, name: "Gbenga", email: null, user_id: "u-noemail", active: true },
      // no email anywhere
      { id: "p-noemail2", tenant_slug: T, name: "Hauwa", email: null, user_id: "u-noemail2", active: true },
      // support role
      { id: "p-support", tenant_slug: T, name: "Ife", email: "ife@team.test", user_id: "u-support", active: true },
      // another tenant's person
      { id: "p-sippy", tenant_slug: "sippy", name: "Jide", email: "jide@team.test", user_id: "u-owner", active: true },
    ],
    memberships: [
      { user_id: "u-owner", tenant_slug: T, role: "owner" },
      { user_id: "u-member", tenant_slug: T, role: "member" },
      { user_id: "u-empty", tenant_slug: T, role: "member" },
      { user_id: "u-other", tenant_slug: "sippy", role: "owner" },
      { user_id: "u-gone", tenant_slug: T, role: "member" },
      { user_id: "u-noemail", tenant_slug: T, role: "admin" },
      { user_id: "u-noemail2", tenant_slug: T, role: "member" },
      { user_id: "u-support", tenant_slug: T, role: "support" },
    ],
  });
}

const resolveEmail = async (userId: string) => (userId === "u-noemail" ? "gbenga@auth.test" : null);

describe("who gets a queue email", () => {
  it("lists only active people with a login in this tenant and an email", async () => {
    const db = seedTeam();
    const list = await listNudgeRecipients(fakeClient(db), T, resolveEmail);
    const byId = Object.fromEntries(list.map((r) => [r.personId, r]));
    expect(Object.keys(byId).sort()).toEqual(["p-empty", "p-member", "p-noemail", "p-owner"]);
    expect(byId["p-noemail"].email).toBe("gbenga@auth.test");
    expect(byId["p-owner"].seesUnassigned).toBe(true);
    expect(byId["p-noemail"].seesUnassigned).toBe(true); // admin
    expect(byId["p-member"].seesUnassigned).toBe(false);
  });

  it("emails people with open work, skips people with nothing open, and tells owners about archived items", async () => {
    const db = seedTeam();
    db.tables.action_items = [
      { id: "a-stale", tenant_slug: T, kind: "chore", title: "Old chore", status: "open", updated_at: daysAgo(40), snoozed_until: null },
    ];
    db.tables.engagement_items = [];
    db.tables.queue_activity_log = [];

    const queues: Record<string, PersonQueue> = {
      "p-owner": { replies: 2, followUps: 1, decisions: 0, oldest: [{ kind: "reply", label: "@lead: hi", ageDays: 4 }] },
      "p-member": { replies: 0, followUps: 0, decisions: 1, oldest: [{ kind: "decision", label: "Pick a venue", ageDays: 2 }] },
      "p-empty": EMPTY,
      "p-noemail": EMPTY,
    };
    const gather = vi.fn(async (_c: unknown, _t: string, r: NudgeRecipient) => queues[r.personId] ?? EMPTY);
    const sent: Array<{ to: string; subject: string; html: string }> = [];
    const send = vi.fn(async (m: { to: string; name: string; subject: string; html: string }) => {
      sent.push(m);
      return { ok: true };
    });

    const res = await runQueueNudgeForTenant(fakeClient(db), { slug: T, name: "Gruve" }, {
      gather,
      send,
      resolveEmail,
      now: NOW,
      appUrl: "https://pulse.test/",
    });

    expect(res.archived).toBe(1);
    expect(res.emailed).toBe(2);
    expect(res.skippedNothingOpen).toBe(2);
    expect(res.errors).toEqual([]);
    expect(sent.map((s) => s.to).sort()).toEqual(["ada@team.test", "bola@team.test"]);

    const owner = sent.find((s) => s.to === "ada@team.test")!;
    expect(owner.subject).toBe("Your queue: 3 items waiting");
    expect(owner.html).toContain("1 stale item over 30 days was archived; find them under Archived.");
    expect(owner.html).toContain('href="https://pulse.test/dashboard"');

    const member = sent.find((s) => s.to === "bola@team.test")!;
    expect(member.html).not.toContain("archived");
  });
});

describe("stale selection", () => {
  it("archives open items untouched for 31 days, keeps 29 days, snoozed and closed ones", async () => {
    const db = new FakeDb({
      action_items: [
        { id: "a31", tenant_slug: T, title: "31 days", status: "open", updated_at: daysAgo(31), snoozed_until: null },
        { id: "a29", tenant_slug: T, title: "29 days", status: "open", updated_at: daysAgo(29), snoozed_until: null },
        { id: "aSnoozeFuture", tenant_slug: T, title: "parked", status: "open", updated_at: daysAgo(60), snoozed_until: daysAhead(3) },
        { id: "aSnoozedStatus", tenant_slug: T, title: "snoozed", status: "snoozed", updated_at: daysAgo(60), snoozed_until: null },
        { id: "aResolved", tenant_slug: T, title: "done", status: "resolved", updated_at: daysAgo(90), snoozed_until: null },
        { id: "aDismissed", tenant_slug: T, title: "no", status: "dismissed", updated_at: daysAgo(90), snoozed_until: null },
        { id: "aOther", tenant_slug: "sippy", title: "other tenant", status: "open", updated_at: daysAgo(90), snoozed_until: null },
      ],
      engagement_items: [
        { id: "e31", tenant_slug: T, body: "hello", from_handle: "lead", status: "open", replied: false, updated_at: daysAgo(31), snoozed_until: null },
        { id: "eHanded", tenant_slug: T, body: "x", status: "handed_off", replied: false, updated_at: daysAgo(90), snoozed_until: null },
        { id: "eResolved", tenant_slug: T, body: "x", status: "resolved", replied: true, updated_at: daysAgo(90), snoozed_until: null },
      ],
      queue_activity_log: [],
    });

    const stale = await selectStaleItems(fakeClient(db), T, NOW);
    expect(stale.map((s) => s.id).sort()).toEqual(["a31", "e31"]);

    const res = await archiveStaleItems(fakeClient(db), T, stale, NOW);
    expect(res).toEqual({ archived: 2 });

    const status = (table: string, id: string) => db.rows(table).find((r) => r.id === id)!.status;
    expect(status("action_items", "a31")).toBe("archived");
    expect(status("engagement_items", "e31")).toBe("archived");
    expect(status("action_items", "a29")).toBe("open");
    expect(status("action_items", "aSnoozeFuture")).toBe("open");
    expect(status("action_items", "aResolved")).toBe("resolved");
    expect(status("action_items", "aOther")).toBe("open");
    expect(status("engagement_items", "eHanded")).toBe("handed_off");
    // Nothing deleted.
    expect(db.rows("action_items")).toHaveLength(7);

    const log = db.rows("queue_activity_log");
    expect(log.map((l) => [l.row_source, l.row_id, l.action, l.actor_id]).sort()).toEqual([
      ["action", "a31", "archived", null],
      ["engagement", "e31", "archived", null],
    ]);
    expect(log.every((l) => l.tenant_slug === T)).toBe(true);
  });

  it("isStale: 29 vs 31 days, expired snooze still counts, replied never", () => {
    expect(isStale({ status: "open", updated_at: daysAgo(29) }, NOW)).toBe(false);
    expect(isStale({ status: "open", updated_at: daysAgo(31) }, NOW)).toBe(true);
    expect(isStale({ status: "open", updated_at: daysAgo(31), snoozed_until: daysAgo(5) }, NOW)).toBe(true);
    expect(isStale({ status: "open", updated_at: daysAgo(31), snoozed_until: daysAhead(1) }, NOW)).toBe(false);
    expect(isStale({ status: "open", updated_at: daysAgo(31), replied: true }, NOW)).toBe(false);
    expect(isStale({ status: "snoozed", updated_at: daysAgo(31) }, NOW)).toBe(false);
  });

  it("archives nothing when the audit row cannot be written", async () => {
    const db = new FakeDb({
      action_items: [{ id: "a31", tenant_slug: T, title: "x", status: "open", updated_at: daysAgo(31), snoozed_until: null }],
    });
    const client = {
      from: (t: string) =>
        t === "queue_activity_log"
          ? { insert: async () => ({ error: { message: "violates check constraint" } }) }
          : db.from(t),
    } as never;
    const res = await archiveStaleItems(client, T, [{ table: "action_items", id: "a31", title: "x", updatedAt: daysAgo(31) }], NOW);
    expect(res.archived).toBe(0);
    expect(res.error).toContain("audit log");
    expect(db.rows("action_items")[0].status).toBe("open");
  });
});

describe("summarizeQueue", () => {
  it("dedupes, counts by kind and keeps the 5 oldest", () => {
    const q = summarizeQueue(
      [
        { key: "a:1", kind: "reply", label: "r1", since: daysAgo(1) },
        { key: "a:1", kind: "reply", label: "dup", since: daysAgo(1) },
        { key: "a:2", kind: "follow_up", label: "f", since: daysAgo(10) },
        { key: "a:3", kind: "decision", label: "d", since: daysAgo(3) },
        { key: "a:4", kind: "reply", label: "r4", since: daysAgo(8) },
        { key: "a:5", kind: "reply", label: "r5", since: daysAgo(6) },
        { key: "a:6", kind: "reply", label: "r6", since: daysAgo(0) },
      ],
      NOW
    );
    expect([q.replies, q.followUps, q.decisions]).toEqual([4, 1, 1]);
    expect(q.oldest.map((o) => o.ageDays)).toEqual([10, 8, 6, 3, 1]);
  });
});

describe("queue email HTML", () => {
  const base = {
    name: "Ada",
    tenantName: "Gruve",
    replies: 1,
    followUps: 0,
    decisions: 0,
    oldest: [],
    archivedCount: 0,
    dashboardUrl: "https://pulse.test/dashboard",
  };

  it("escapes every dynamic value", () => {
    const html = buildQueueNudgeEmail({
      ...base,
      name: `<script>alert(1)</script>`,
      tenantName: `Bar & "Grill"`,
      oldest: [{ kind: "reply", label: `<img src=x onerror=alert(1)> it's`, ageDays: 3 }],
      dashboardUrl: `https://pulse.test/dashboard" onclick="x`,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Bar &amp; &quot;Grill&quot;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; it&#39;s");
    expect(html).toContain('href="https://pulse.test/dashboard&quot; onclick=&quot;x"');
  });

  it("escapeHtml handles all five characters and nullish", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(escapeHtml(null)).toBe("");
  });

  it("shows counts, ages, at most 5 items, and no em dashes", () => {
    const html = buildQueueNudgeEmail({
      ...base,
      replies: 3,
      followUps: 2,
      decisions: 1,
      oldest: Array.from({ length: 7 }, (_, i) => ({ kind: "reply" as const, label: `item ${i}`, ageDays: 7 - i })),
      archivedCount: 12,
    });
    expect(html).toContain("item 4");
    expect(html).not.toContain("item 5");
    expect(html).toContain("12 stale items over 30 days were archived; find them under Archived.");
    expect(html).not.toMatch(/[—–]/);
    expect(queueNudgeSubject({ ...base, replies: 1 })).toBe("Your queue: 1 item waiting");
    expect(formatAge(0)).toBe("today");
    expect(formatAge(1)).toBe("1 day");
    expect(formatAge(9)).toBe("9 days");
  });
});
