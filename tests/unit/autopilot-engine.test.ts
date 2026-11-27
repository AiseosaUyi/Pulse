import { describe, it, expect, vi, beforeEach } from "vitest";

// Reply recording triggers AI analysis; never call a model from a unit test.
vi.mock("@/lib/services/outreach-intelligence", () => ({ analyzeConversationSystem: vi.fn(async () => undefined) }));

import { FakeDb, fakeClient } from "../helpers/fake-db";
import { sendDueForTenant } from "@/lib/outreach-autopilot/sender";
import { draftDueFollowUps } from "@/lib/outreach-autopilot/followups";
import { decideDraft, unapproveDraft } from "@/lib/outreach-autopilot/review";
import { applyMail, parseRawMail, pollReplies, type InboxReader } from "@/lib/outreach-autopilot/replies";
import { buildDigestEmail, mintDigestToken, verifyDigestToken } from "@/lib/outreach-autopilot/digest";
import type { MailboxConfig, MailTransport } from "@/lib/outreach-autopilot/mailbox";

const T = "sippy";
const FRI_10AM_LAGOS = new Date("2026-11-27T09:00:00Z");

const mailbox = (over: Partial<MailboxConfig> = {}): MailboxConfig => ({
  tenantSlug: T,
  fromEmail: "contact@sippy.life",
  fromName: "Sippy",
  replyTo: null,
  smtpHost: "mx.gruve.events",
  smtpPort: 587,
  smtpUser: "contact@sippy.life",
  imapHost: "mx.gruve.events",
  imapPort: 993,
  enabled: true,
  dailyCap: 30,
  sendWindowStart: 9,
  sendWindowEnd: 17,
  sendWeekdays: [1, 2, 3, 4, 5],
  autoFollowUps: true,
  followUp1Days: 3,
  followUp2Days: 7,
  approverEmail: "owner@example.com",
  digestHour: 8,
  autoCompose: true,
  lastDigestAt: null,
  imapUidValidity: 1,
  imapLastUid: 10,
  imapCheckedAt: null,
  lastError: null,
  hasPassword: true,
  ...over,
});

function prospect(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    tenant_slug: T,
    status: "drafted",
    email: `${id}@${id}.com`,
    email_status: "verified",
    channel_handoff: "none",
    website: `https://${id}.com`,
    handle: id,
    company_name: `${id} Ltd`,
    platform: "instagram",
    verified_name: "Ada Obi",
    ...over,
  };
}

function dm(id: string, prospectId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    tenant_slug: T,
    prospect_id: prospectId,
    version: 1,
    kind: "cold_open",
    subject: `Hello ${prospectId}`,
    body: "Hi Ada,\n\nBody.\n\nSippy",
    to_email: `${prospectId}@${prospectId}.com`,
    status: "approved",
    send_via: "mailbox",
    scheduled_send_at: "2026-11-27T08:00:00.000Z",
    send_attempts: 0,
    created_at: "2026-11-26T08:00:00.000Z",
    ...over,
  };
}

function fakeTransport(impl?: (msg: Parameters<MailTransport["sendMail"]>[0]) => Promise<unknown>) {
  const sent: Array<Parameters<MailTransport["sendMail"]>[0]> = [];
  const t: MailTransport = {
    async sendMail(msg) {
      if (impl) await impl(msg);
      sent.push(msg);
      return { messageId: msg.messageId };
    },
  };
  return { t, sent };
}

const deps = (t: MailTransport, now = FRI_10AM_LAGOS) => ({
  now,
  timeZone: "Africa/Lagos",
  getTransport: async () => t,
  sleep: async () => undefined,
});

describe("sender", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb({ prospects: [prospect("p1")], outbound_dms: [dm("d1", "p1")], outreach_ledger: [] });
  });

  it("sends an approved email, threads it, marks sent and records CONTACTED", async () => {
    const { t, sent } = fakeTransport();
    const r = await sendDueForTenant(fakeClient(db), mailbox(), deps(t));
    expect(r.sent).toBe(1);
    expect(sent[0]).toMatchObject({ to: "p1@p1.com", subject: "Hello p1", from: '"Sippy" <contact@sippy.life>' });
    expect(sent[0].messageId).toMatch(/^<.+@sippy\.life>$/);
    expect(sent[0].headers?.["List-Unsubscribe"]).toContain("mailto:contact@sippy.life");
    const row = db.rows("outbound_dms")[0];
    expect(row).toMatchObject({ status: "sent", message_id: sent[0].messageId });
    expect(db.rows("prospects")[0].status).toBe("sent");
    const ledger = db.rows("outreach_ledger").map((l) => `${l.key_type}:${l.key}:${l.kind}`);
    expect(ledger).toContain("EMAIL:p1@p1.com:CONTACTED");
  });

  it("never sends rows a human did not approve through autopilot", async () => {
    db.rows("outbound_dms")[0].send_via = null; // legacy in-app 'approved'
    db.rows("outbound_dms").push(dm("d2", "p1", { status: "drafted" }));
    const { t, sent } = fakeTransport();
    const r = await sendDueForTenant(fakeClient(db), mailbox(), deps(t));
    expect(sent).toHaveLength(0);
    expect(r.skippedReason).toBe("nothing approved");
  });

  it("does nothing when disabled, outside the window, or at the cap", async () => {
    const { t, sent } = fakeTransport();
    expect((await sendDueForTenant(fakeClient(db), mailbox({ enabled: false }), deps(t))).skippedReason).toBe("mailbox disabled");
    expect((await sendDueForTenant(fakeClient(db), mailbox(), deps(t, new Date("2026-11-28T10:00:00Z")))).skippedReason).toBe(
      "outside send window"
    );
    db.rows("outbound_dms").push(dm("x", "p1", { status: "sent", sent_at: "2026-11-27T08:30:00.000Z" }));
    expect((await sendDueForTenant(fakeClient(db), mailbox({ dailyCap: 1 }), deps(t))).skippedReason).toBe("daily cap reached");
    expect(sent).toHaveLength(0);
  });

  it("cancels instead of sending when the prospect replied or was handed off", async () => {
    db.rows("prospects")[0].status = "replied";
    const { t, sent } = fakeTransport();
    const r = await sendDueForTenant(fakeClient(db), mailbox(), deps(t));
    expect(sent).toHaveLength(0);
    expect(r.cancelled).toBe(1);
    expect(db.rows("outbound_dms")[0].status).toBe("cancelled");

    db.rows("prospects")[0].status = "drafted";
    db.rows("prospects")[0].channel_handoff = "whatsapp";
    db.rows("outbound_dms")[0].status = "approved";
    await sendDueForTenant(fakeClient(db), mailbox(), deps(t));
    expect(sent).toHaveLength(0);
  });

  it("does not send a first email to a company already contacted", async () => {
    db.rows("outreach_ledger").push({ workspace: T, key_type: "DOMAIN", key: "p1.com", kind: "CONTACTED" });
    const { t, sent } = fakeTransport();
    const r = await sendDueForTenant(fakeClient(db), mailbox(), deps(t));
    expect(sent).toHaveLength(0);
    expect(r.cancelled).toBe(1);
    expect(String(db.rows("outbound_dms")[0].error)).toContain("already CONTACTED");
  });

  it("retries a temporary failure later and gives up on a permanent one", async () => {
    const temp = fakeTransport(async () => {
      throw Object.assign(new Error("try later"), { responseCode: 421 });
    });
    await sendDueForTenant(fakeClient(db), mailbox(), deps(temp.t));
    expect(db.rows("outbound_dms")[0]).toMatchObject({ status: "approved", send_attempts: 1 });
    expect(String(db.rows("outbound_dms")[0].scheduled_send_at) > FRI_10AM_LAGOS.toISOString()).toBe(true);

    db.rows("outbound_dms")[0].scheduled_send_at = "2026-11-27T08:00:00.000Z";
    const perm = fakeTransport(async () => {
      throw Object.assign(new Error("no such user"), { responseCode: 550 });
    });
    const r = await sendDueForTenant(fakeClient(db), mailbox(), deps(perm.t));
    expect(r.failed).toBe(1);
    expect(db.rows("outbound_dms")[0].status).toBe("failed");
  });

  it("marks a row stuck in 'sending' as failed and never resends it", async () => {
    db.rows("outbound_dms")[0].status = "sending";
    db.rows("outbound_dms")[0].claimed_at = "2026-11-27T08:00:00.000Z";
    const { t, sent } = fakeTransport();
    await sendDueForTenant(fakeClient(db), mailbox(), deps(t));
    expect(sent).toHaveLength(0);
    expect(db.rows("outbound_dms")[0].status).toBe("failed");
  });

  it("threads a follow-up under the original and skips it if the original got a reply", async () => {
    db.rows("outbound_dms")[0] = dm("d1", "p1", { status: "sent", message_id: "<orig@sippy.life>" });
    db.rows("outbound_dms").push(dm("f1", "p1", { kind: "follow_up_1", parent_dm_id: "d1", subject: "Re: Hello p1" }));
    db.rows("prospects")[0].status = "sent";
    const { t, sent } = fakeTransport();
    await sendDueForTenant(fakeClient(db), mailbox(), deps(t));
    expect(sent[0]).toMatchObject({ inReplyTo: "<orig@sippy.life>", references: ["<orig@sippy.life>"] });

    db.rows("outbound_dms").push(dm("f2", "p1", { kind: "follow_up_2", parent_dm_id: "d1" }));
    db.rows("outbound_dms")[0].status = "replied";
    await sendDueForTenant(fakeClient(db), mailbox(), deps(t));
    expect(sent).toHaveLength(1);
    expect(db.rows("outbound_dms").find((r) => r.id === "f2")?.status).toBe("cancelled");
  });

  it("two overlapping runs send a row once", async () => {
    const { t, sent } = fakeTransport();
    await Promise.all([
      sendDueForTenant(fakeClient(db), mailbox(), deps(t)),
      sendDueForTenant(fakeClient(db), mailbox(), deps(t)),
    ]);
    expect(sent).toHaveLength(1);
  });
});

describe("follow-ups", () => {
  const copy = { followUp1Body: "{greeting}\n\nAny thoughts on {company}?\n\n{signature}", followUp2Body: "{greeting}\n\nLast one.\n\n{signature}", signature: "Sippy" };
  const now = new Date("2026-11-27T09:00:00Z");

  function seed(sentAt: string, prospectOver: Record<string, unknown> = {}) {
    return new FakeDb({
      prospects: [prospect("p1", { status: "sent", ...prospectOver })],
      outbound_dms: [dm("d1", "p1", { status: "sent", sent_at: sentAt, message_id: "<o@x>" })],
      inbound_messages: [],
    });
  }

  it("drafts follow-up 1 after the wait, in the same thread, for approval", async () => {
    const db = seed("2026-11-23T09:00:00.000Z");
    const r = await draftDueFollowUps(fakeClient(db), mailbox(), copy, now);
    expect(r.drafted).toBe(1);
    const f = db.rows("outbound_dms").find((x) => x.kind === "follow_up_1")!;
    expect(f).toMatchObject({ status: "drafted", parent_dm_id: "d1", subject: "Re: Hello p1", to_email: "p1@p1.com" });
    expect(f.body).toBe("Hi Ada,\n\nAny thoughts on p1 Ltd?\n\nSippy");
    expect(f.send_via ?? null).toBeNull(); // still needs a human
    // Running again does not draft a second one.
    expect((await draftDueFollowUps(fakeClient(db), mailbox(), copy, now)).drafted).toBe(0);
  });

  it("waits until the delay has passed", async () => {
    const db = seed("2026-11-25T09:00:00.000Z");
    expect((await draftDueFollowUps(fakeClient(db), mailbox(), copy, now)).drafted).toBe(0);
  });

  it("stops for replies, handoffs, bounces and when turned off", async () => {
    const old = "2026-11-20T09:00:00.000Z";
    expect((await draftDueFollowUps(fakeClient(seed(old, { status: "replied" })), mailbox(), copy, now)).drafted).toBe(0);
    expect((await draftDueFollowUps(fakeClient(seed(old, { channel_handoff: "phone" })), mailbox(), copy, now)).drafted).toBe(0);
    expect((await draftDueFollowUps(fakeClient(seed(old, { email_status: "dropped" })), mailbox(), copy, now)).drafted).toBe(0);
    expect((await draftDueFollowUps(fakeClient(seed(old)), mailbox({ autoFollowUps: false }), copy, now)).drafted).toBe(0);
    const withReply = seed(old);
    withReply.rows("inbound_messages").push({ tenant_slug: T, prospect_id: "p1", body: "hi" });
    expect((await draftDueFollowUps(fakeClient(withReply), mailbox(), copy, now)).drafted).toBe(0);
  });

  it("drafts follow-up 2 from a sent follow-up 1", async () => {
    const db = seed("2026-11-10T09:00:00.000Z");
    db.rows("outbound_dms").push(
      dm("f1", "p1", { kind: "follow_up_1", parent_dm_id: "d1", status: "sent", sent_at: "2026-11-22T09:00:00.000Z" })
    );
    const r = await draftDueFollowUps(fakeClient(db), mailbox(), copy, now);
    expect(r.drafted).toBe(1);
    expect(db.rows("outbound_dms").find((x) => x.kind === "follow_up_2")).toMatchObject({ parent_dm_id: "f1" });
  });
});

describe("review decisions", () => {
  const draft = () => new FakeDb({ outbound_dms: [dm("d1", "p1", { status: "drafted", send_via: null })] });

  it("approve queues it for the mailbox with any edits", async () => {
    const db = draft();
    const r = await decideDraft(fakeClient(db), T, { dmId: "d1", action: "approve", subject: "New subject" }, { via: "email_digest", userId: null });
    expect(r.ok).toBe(true);
    expect(db.rows("outbound_dms")[0]).toMatchObject({ status: "approved", send_via: "mailbox", subject: "New subject", approved_via: "email_digest" });
  });

  it("a digest link can only touch its own drafts, in its own tenant, once", async () => {
    const db = draft();
    expect((await decideDraft(fakeClient(db), T, { dmId: "d1", action: "approve" }, { via: "email_digest", userId: null, allowedIds: ["other"] })).ok).toBe(false);
    expect((await decideDraft(fakeClient(db), "gruve", { dmId: "d1", action: "approve" }, { via: "in_app", userId: "u" })).ok).toBe(false);
    expect((await decideDraft(fakeClient(db), T, { dmId: "d1", action: "skip" }, { via: "in_app", userId: "u" })).ok).toBe(true);
    const again = await decideDraft(fakeClient(db), T, { dmId: "d1", action: "approve" }, { via: "in_app", userId: "u" });
    expect(again).toEqual({ ok: false, error: "Already decided or not found" });
    expect(db.rows("outbound_dms")[0].status).toBe("cancelled");
  });

  it("rejects empty edits and can pull back an approved email", async () => {
    const db = draft();
    expect((await decideDraft(fakeClient(db), T, { dmId: "d1", action: "approve", body: "  " }, { via: "in_app", userId: "u" })).ok).toBe(false);
    await decideDraft(fakeClient(db), T, { dmId: "d1", action: "approve" }, { via: "in_app", userId: "u" });
    expect((await unapproveDraft(fakeClient(db), T, "d1")).ok).toBe(true);
    expect(db.rows("outbound_dms")[0]).toMatchObject({ status: "drafted", send_via: null });
  });
});

const raw = (headers: string, body: string) => Buffer.from(`${headers}\n\n${body}`.replace(/\n/g, "\r\n"));

describe("replies", () => {
  function seeded() {
    return new FakeDb({
      prospects: [prospect("p1", { status: "sent" })],
      outbound_dms: [
        dm("d1", "p1", { status: "sent", sent_at: "2026-11-24T09:00:00.000Z", message_id: "<orig@sippy.life>" }),
        dm("f1", "p1", { kind: "follow_up_1", parent_dm_id: "d1", status: "approved" }),
      ],
      inbound_messages: [],
    });
  }

  it("parses a human reply and matches it by thread", async () => {
    const mail = await parseRawMail(
      raw(
        "From: Ada <P1@p1.com>\nTo: contact@sippy.life\nSubject: Re: Hello p1\nIn-Reply-To: <orig@sippy.life>\nMessage-ID: <r1@p1.com>",
        "Sounds good, call me.\n\nOn Mon, Aise wrote:\n> Hi"
      )
    );
    expect(mail).toMatchObject({ from: "p1@p1.com", inReplyTo: "<orig@sippy.life>", isAutoReply: false, bouncedRecipient: null });

    const db = seeded();
    const r = await applyMail(fakeClient(db), T, mail, ["contact@sippy.life"]);
    expect(r.kind).toBe("reply");
    expect(db.rows("inbound_messages")[0]).toMatchObject({ prospect_id: "p1", body: "Sounds good, call me.", in_reply_to_dm_id: "d1" });
    expect(db.rows("prospects")[0].status).toBe("replied");
    expect(db.rows("outbound_dms").find((x) => x.id === "f1")?.status).toBe("cancelled");
  });

  it("ignores out-of-office replies so the sequence continues", async () => {
    const mail = await parseRawMail(
      raw("From: p1@p1.com\nTo: contact@sippy.life\nSubject: Out of Office\nAuto-Submitted: auto-replied", "Away until Monday")
    );
    expect(mail.isAutoReply).toBe(true);
    const db = seeded();
    expect((await applyMail(fakeClient(db), T, mail, ["contact@sippy.life"])).kind).toBe("ignored");
    expect(db.rows("outbound_dms").find((x) => x.id === "f1")?.status).toBe("approved");
  });

  it("handles a bounce: email failed, address dropped, follow-ups stopped", async () => {
    const mail = await parseRawMail(
      raw(
        'From: Mail Delivery System <MAILER-DAEMON@mx.gruve.events>\nTo: contact@sippy.life\nSubject: Undelivered Mail\nContent-Type: multipart/report; report-type=delivery-status; boundary="b"',
        '--b\nContent-Type: text/plain\n\nDelivery failed.\n--b\nContent-Type: message/delivery-status\n\nFinal-Recipient: rfc822; p1@p1.com\nAction: failed\nStatus: 5.1.1\n--b--'
      )
    );
    expect(mail.bouncedRecipient).toBe("p1@p1.com");
    const db = seeded();
    expect((await applyMail(fakeClient(db), T, mail, ["contact@sippy.life"])).kind).toBe("bounce");
    expect(db.rows("outbound_dms").find((x) => x.id === "d1")?.status).toBe("failed");
    expect(db.rows("prospects")[0].email_status).toBe("dropped");
    expect(db.rows("outbound_dms").find((x) => x.id === "f1")?.status).toBe("cancelled");
  });

  it("an opt-out closes the prospect", async () => {
    const mail = await parseRawMail(raw("From: p1@p1.com\nSubject: unsubscribe", "unsubscribe"));
    const db = seeded();
    const r = await applyMail(fakeClient(db), T, mail, ["contact@sippy.life"]);
    expect(r.kind === "reply" && r.event.optOut).toBe(true);
    expect(db.rows("prospects")[0].status).toBe("closed_lost");
  });

  it("ignores mail from strangers and from our own address", async () => {
    const db = seeded();
    const stranger = await parseRawMail(raw("From: someone@else.com\nSubject: hi", "hello"));
    expect((await applyMail(fakeClient(db), T, stranger, ["contact@sippy.life"])).kind).toBe("ignored");
    const own = await parseRawMail(raw("From: contact@sippy.life\nSubject: hi\nIn-Reply-To: <orig@sippy.life>", "x"));
    expect((await applyMail(fakeClient(db), T, own, ["contact@sippy.life"])).kind).toBe("ignored");
    expect(db.rows("inbound_messages")).toHaveLength(0);
  });

  it("first poll starts from now; later polls only read new mail and advance", async () => {
    const db = new FakeDb({
      outreach_mailboxes: [{ tenant_slug: T }],
      prospects: [prospect("p1", { status: "sent" })],
      outbound_dms: [dm("d1", "p1", { status: "sent", sent_at: "2026-11-24T09:00:00.000Z", message_id: "<orig@sippy.life>" })],
      inbound_messages: [],
    });
    const reader = (msgs: Array<{ uid: number; source: Buffer }>): InboxReader => ({
      uidValidity: 7,
      uidNext: 50,
      async *fetchSince(after) {
        for (const m of msgs) if (m.uid > after) yield m;
      },
      close: async () => undefined,
    });
    const first = await pollReplies(fakeClient(db), mailbox({ imapLastUid: null, imapUidValidity: null }), reader([]));
    expect(first.processed).toBe(0);
    expect(db.rows("outreach_mailboxes")[0]).toMatchObject({ imap_uid_validity: 7, imap_last_uid: 49 });

    const reply = raw("From: p1@p1.com\nSubject: Re\nIn-Reply-To: <orig@sippy.life>", "yes");
    const second = await pollReplies(
      fakeClient(db),
      mailbox({ imapLastUid: 49, imapUidValidity: 7 }),
      reader([{ uid: 49, source: reply }, { uid: 50, source: reply }])
    );
    expect(second.processed).toBe(1);
    expect(second.replies).toHaveLength(1);
    expect(db.rows("outreach_mailboxes")[0].imap_last_uid).toBe(50);
  });
});

describe("digest", () => {
  it("token round-trips and a tampered token fails", async () => {
    process.env.APPROVAL_TOKEN_SECRET = "test-secret-at-least-32-characters-long!!";
    const tok = await mintDigestToken("11111111-1111-1111-1111-111111111111");
    expect(await verifyDigestToken(tok)).toEqual({ ok: true, digestId: "11111111-1111-1111-1111-111111111111" });
    expect((await verifyDigestToken(tok.slice(0, -2) + "xx")).ok).toBe(false);
    const old = await mintDigestToken("x", Date.now() - 100 * 60 * 60 * 1000);
    expect(await verifyDigestToken(old)).toEqual({ ok: false, reason: "expired" });
  });

  it("escapes prospect-controlled text in the email", () => {
    const e = buildDigestEmail({
      tenantName: "Sippy",
      url: "https://pulse.test/approve/outreach/t",
      stats: { sentYesterday: 3, repliesWaiting: 1, failed: 0 },
      drafts: [{ subject: "<script>x</script>", toEmail: "a@b.com", kind: "cold_open", firstLine: "<img src=x>" }],
    });
    expect(e.subject).toBe("Sippy: 1 email ready for your OK");
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<img");
    expect(e.html).toContain("Review and approve");
  });
});
