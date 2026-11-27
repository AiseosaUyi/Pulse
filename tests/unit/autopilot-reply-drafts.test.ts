import { describe, it, expect, vi } from "vitest";
import { FakeDb, fakeClient } from "../helpers/fake-db";
import { draftRepliesForEvents } from "@/lib/outreach-autopilot/reply-draft";
import { buildReplyAlertEmail, finishReplyBody, replyNotes, type ReplyWriter } from "@/lib/outreach-autopilot/reply-copy";
import { sendDueForTenant } from "@/lib/outreach-autopilot/sender";
import type { MailboxConfig, MailTransport } from "@/lib/outreach-autopilot/mailbox";
import type { ReplyEvent } from "@/lib/outreach-autopilot/replies";

const T = "acme";
const SIG = "Jane\nAcme";

const mailbox = {
  tenantSlug: T,
  fromEmail: "hello@acme.ng",
  fromName: "Jane from Acme",
  replyTo: null,
  smtpHost: "mail.acme.ng",
  smtpPort: 587,
  smtpUser: "hello@acme.ng",
  imapHost: "mail.acme.ng",
  imapPort: 993,
  enabled: true,
  dailyCap: 30,
  sendWindowStart: 9,
  sendWindowEnd: 17,
  sendWeekdays: [1, 2, 3, 4, 5],
  autoFollowUps: true,
  followUp1Days: 3,
  followUp2Days: 7,
  approverEmail: "owner@acme.ng",
  digestHour: 8,
  autoCompose: true,
  lastDigestAt: null,
  imapUidValidity: 1,
  imapLastUid: 10,
  imapCheckedAt: null,
  lastError: null,
  hasPassword: true,
} as unknown as MailboxConfig;

function seed(prospectOver: Record<string, unknown> = {}) {
  return new FakeDb({
    prospects: [
      { id: "p1", tenant_slug: T, status: "replied", channel_handoff: "none", email_status: "verified", verified_name: "Ada Obi", company_name: "Lounge Ltd", handle: "lounge", ...prospectOver },
    ],
    outbound_dms: [
      { id: "d1", tenant_slug: T, prospect_id: "p1", version: 1, kind: "cold_open", subject: "Drinks for Lounge", body: "Hi Ada, first email", to_email: "ada@lounge.ng", status: "replied", send_via: "mailbox", message_id: "<m1@acme.ng>", sent_at: "2026-11-25T09:00:00.000Z" },
    ],
    inbound_messages: [
      { id: "i1", tenant_slug: T, prospect_id: "p1", body: "Sounds good. What are your delivery days to Lekki?", received_at: "2026-11-27T08:00:00.000Z" },
    ],
  });
}

const event = (over: Partial<ReplyEvent> = {}): ReplyEvent => ({
  prospectId: "p1",
  from: "ada@lounge.ng",
  subject: "Re: Drinks for Lounge",
  snippet: "Sounds good. What are your delivery days to Lekki?",
  optOut: false,
  ...over,
});

const writer = (body: string | null = "Hi Ada,\n\nThanks. I'll confirm our Lekki delivery days today. Could we do a 15 minute call on Monday?") =>
  vi.fn<ReplyWriter>(async () => ({ intent: "question", summary: "Asked about delivery days", body, needsHuman: "Delivery days to Lekki" }));

describe("reply drafts", () => {
  it("drafts an answer in the same thread, to whoever replied, waiting for approval", async () => {
    const db = seed();
    const w = writer();
    const out = await draftRepliesForEvents(fakeClient(db), mailbox, [event()], w, SIG);

    expect(w).toHaveBeenCalledTimes(1);
    expect(w.mock.calls[0][0].latest).toContain("delivery days to Lekki");
    expect(w.mock.calls[0][0].thread.map((m) => m.direction)).toEqual(["outbound", "inbound"]);
    const reply = db.rows("outbound_dms").find((d) => d.kind === "reply")!;
    expect(reply).toMatchObject({ status: "drafted", parent_dm_id: "d1", to_email: "ada@lounge.ng", subject: "Re: Drinks for Lounge", version: 2 });
    expect(reply.send_via ?? null).toBeNull();
    expect(String(reply.body)).toMatch(/Monday\?\n\nJane\nAcme$/);
    expect(reply.lint_warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Asked a question"), "Check before approving: Delivery days to Lekki"])
    );
    expect(out[0]).toMatchObject({ intent: "question", dmId: reply.id, company: "Lounge Ltd" });
  });

  it("never drafts for an opt-out, a closed lead or a handed-off lead", async () => {
    for (const [ev, over] of [
      [event({ optOut: true }), {}],
      [event(), { status: "closed_lost" }],
      [event(), { channel_handoff: "whatsapp" }],
    ] as const) {
      const db = seed(over);
      const w = writer();
      await draftRepliesForEvents(fakeClient(db), mailbox, [ev], w, SIG);
      expect(w).not.toHaveBeenCalled();
      expect(db.rows("outbound_dms").filter((d) => d.kind === "reply")).toHaveLength(0);
    }
  });

  it("no AI (budget spent or failed): no draft, the reply is still reported", async () => {
    const db = seed();
    const out = await draftRepliesForEvents(fakeClient(db), mailbox, [event()], null, SIG);
    expect(out[0]).toMatchObject({ dmId: null, draft: null, company: "Lounge Ltd" });
    const failing = vi.fn<ReplyWriter>(async () => {
      throw new Error("down");
    });
    expect((await draftRepliesForEvents(fakeClient(db), mailbox, [event()], failing, SIG))[0].dmId).toBeNull();
  });

  it("a second reply pulls an approved, unsent answer back to draft and rewrites it", async () => {
    const db = seed();
    await draftRepliesForEvents(fakeClient(db), mailbox, [event()], writer(), SIG);
    const reply = db.rows("outbound_dms").find((d) => d.kind === "reply")!;
    Object.assign(reply, { status: "approved", send_via: "mailbox", approved_at: "x", scheduled_send_at: "x" });

    await draftRepliesForEvents(fakeClient(db), mailbox, [event()], writer("Hi Ada,\n\nNew answer."), SIG);
    const replies = db.rows("outbound_dms").filter((d) => d.kind === "reply");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ status: "drafted", send_via: null, scheduled_send_at: null });
    expect(String(replies[0].body)).toContain("New answer.");
  });

  it("leaves an answer that already went out alone", async () => {
    const db = seed();
    await draftRepliesForEvents(fakeClient(db), mailbox, [event()], writer(), SIG);
    const reply = db.rows("outbound_dms").find((d) => d.kind === "reply")!;
    reply.status = "sending";
    const w = writer("changed");
    await draftRepliesForEvents(fakeClient(db), mailbox, [event()], w, SIG);
    expect(w).not.toHaveBeenCalled();
  });

  it("a not-interested reply with no answer needed creates no draft", async () => {
    const db = seed();
    const w = vi.fn<ReplyWriter>(async () => ({ intent: "not_interested", summary: "No", body: null, needsHuman: null }));
    const out = await draftRepliesForEvents(fakeClient(db), mailbox, [event()], w, SIG);
    expect(out[0]).toMatchObject({ intent: "not_interested", dmId: null });
    expect(db.rows("outbound_dms").filter((d) => d.kind === "reply")).toHaveLength(0);
  });
});

describe("sender and approved answers", () => {
  const transport = () => {
    const sent: Array<Parameters<MailTransport["sendMail"]>[0]> = [];
    const t: MailTransport = { async sendMail(m) { sent.push(m); return { messageId: m.messageId }; } };
    return { t, sent };
  };
  const deps = (t: MailTransport) => ({
    now: new Date("2026-11-27T09:00:00Z"),
    timeZone: "Africa/Lagos",
    getTransport: async () => t,
    sleep: async () => undefined,
  });

  it("sends an approved answer to a replied lead, threaded under our email", async () => {
    const db = seed();
    db.rows("outbound_dms").push({
      id: "r1", tenant_slug: T, prospect_id: "p1", version: 2, kind: "reply", parent_dm_id: "d1", subject: "Re: Drinks for Lounge",
      body: "Hi Ada", to_email: "ada@lounge.ng", status: "approved", send_via: "mailbox", scheduled_send_at: "2026-11-27T08:00:00.000Z", send_attempts: 0,
    });
    const { t, sent } = transport();
    const r = await sendDueForTenant(fakeClient(db), mailbox, deps(t));
    expect(r.sent).toBe(1);
    expect(sent[0]).toMatchObject({ to: "ada@lounge.ng", inReplyTo: "<m1@acme.ng>" });
    expect(db.rows("prospects")[0].status).toBe("replied");
  });

  it("still cancels an approved answer once the lead is closed", async () => {
    const db = seed({ status: "closed_lost" });
    db.rows("outbound_dms").push({
      id: "r1", tenant_slug: T, prospect_id: "p1", version: 2, kind: "reply", parent_dm_id: "d1", subject: "Re: x",
      body: "Hi", to_email: "ada@lounge.ng", status: "approved", send_via: "mailbox", scheduled_send_at: "2026-11-27T08:00:00.000Z", send_attempts: 0,
    });
    const { t, sent } = transport();
    const r = await sendDueForTenant(fakeClient(db), mailbox, deps(t));
    expect(sent).toHaveLength(0);
    expect(r.cancelled).toBe(1);
  });

  it("a follow-up to someone who replied is still cancelled", async () => {
    const db = seed({ status: "sent" });
    db.rows("outbound_dms").push({
      id: "f1", tenant_slug: T, prospect_id: "p1", version: 2, kind: "follow_up_1", parent_dm_id: "d1", subject: "Re: x",
      body: "Hi", to_email: "ada@lounge.ng", status: "approved", send_via: "mailbox", scheduled_send_at: "2026-11-27T08:00:00.000Z", send_attempts: 0,
    });
    const { t, sent } = transport();
    await sendDueForTenant(fakeClient(db), mailbox, deps(t));
    expect(sent).toHaveLength(0);
  });
});

describe("reply copy helpers", () => {
  it("house style and one signature", () => {
    expect(finishReplyBody("Hi Ada!\n\nGreat — talk soon.", "Jane")).toBe("Hi Ada.\n\nGreat, talk soon.\n\nJane");
    expect(finishReplyBody("Hi\n\nJane", "Jane")).toBe("Hi\n\nJane");
  });

  it("flags money and links in a draft", () => {
    const notes = replyNotes({ intent: "interested", summary: "", body: "We can do ₦50,000, see www.x.com", needsHuman: null }, "yes");
    expect(notes).toHaveLength(3);
  });

  it("alert email lists every reply, shows drafts and escapes their text", () => {
    const e = buildReplyAlertEmail({
      tenantName: "Acme",
      approveUrl: "https://app/approve/outreach/t",
      autopilotUrl: "https://app/autopilot",
      items: [
        { from: "a@x.ng", company: "X", snippet: "<b>hi</b>", optOut: false, intent: "interested", draft: "Hi A" },
        { from: "b@y.ng", company: null, snippet: "stop", optOut: true, intent: null, draft: null },
      ],
    });
    expect(e.subject).toBe("Acme: 2 new replies, 1 answer ready");
    expect(e.html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(e.html).toContain("Asked to stop");
    expect(e.html).toContain("https://app/approve/outreach/t");
  });
});
