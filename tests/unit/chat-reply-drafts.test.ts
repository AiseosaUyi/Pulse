import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/outreach-intelligence", () => ({ analyzeConversationSystem: vi.fn(async () => undefined) }));

import { FakeDb, fakeClient } from "../helpers/fake-db";
import { sendDueForTenant } from "@/lib/outreach-autopilot/sender";
import { decideDraft, editDraft, listReviewDrafts, markSentByHand, unapproveDraft } from "@/lib/outreach-autopilot/review";
import { chatContact, chatMessageId, importChatAndDraft } from "@/lib/outreach-autopilot/chat-reply";
import type { MailboxConfig, MailTransport } from "@/lib/outreach-autopilot/mailbox";
import type { ReplyWriter } from "@/lib/outreach-autopilot/reply-copy";

const T = "sippy";
const V = "2026-11-28T09:00:00.000Z";

const prospect = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  tenant_slug: T,
  status: "sent",
  channel_handoff: "none",
  handle: id,
  platform: "instagram",
  phone: "0803 123 4567",
  company_name: `${id} Lounge`,
  verified_name: "Ada Obi",
  owner_person_id: "person-a",
  ...over,
});

const chatDm = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  tenant_slug: T,
  prospect_id: "p1",
  version: 1,
  kind: "reply",
  channel: "whatsapp",
  to_contact: "+2348031234567",
  to_email: null,
  subject: null,
  body: "Hi Ada, yes we deliver on Saturdays.",
  status: "drafted",
  send_via: null,
  lint_warnings: [],
  created_at: "2026-11-28T08:00:00.000Z",
  updated_at: V,
  ...over,
});

const writer: ReplyWriter = async () => ({
  intent: "question",
  summary: "Asked about delivery",
  body: "Hi Ada, yes we deliver on Saturdays. Want me to book one?",
  needsHuman: null,
});

describe("chat drafts: approve and send by hand", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb({ prospects: [prospect("p1")], outbound_dms: [chatDm("c1")] });
  });

  it("approving a WhatsApp draft marks it for hand sending and never queues the mailbox", async () => {
    const r = await decideDraft(fakeClient(db), T, { dmId: "c1", action: "approve", expectedUpdatedAt: V }, { via: "in_app", userId: "u1" });
    expect(r.ok).toBe(true);
    const row = db.rows("outbound_dms")[0];
    expect(row).toMatchObject({ status: "approved", send_via: "by_hand", scheduled_send_at: null, approved_by: "u1" });
  });

  it("the mailbox sender never sends a chat row, even if one were marked mailbox", async () => {
    db.rows("outbound_dms")[0] = chatDm("c1", { status: "approved", send_via: "mailbox", scheduled_send_at: "2026-11-27T08:00:00.000Z", to_email: "x@x.com" });
    const sent: unknown[] = [];
    const t: MailTransport = { async sendMail(m) { sent.push(m); return { messageId: m.messageId }; } };
    const box = { tenantSlug: T, fromEmail: "contact@sippy.life", fromName: "Sippy", replyTo: null, enabled: true, dailyCap: 30, sendWindowStart: 9, sendWindowEnd: 17, sendWeekdays: [1, 2, 3, 4, 5] } as unknown as MailboxConfig;
    await sendDueForTenant(fakeClient(db), box, { now: new Date("2026-11-27T09:00:00Z"), timeZone: "Africa/Lagos", getTransport: async () => t, sleep: async () => undefined });
    expect(sent).toHaveLength(0);
    expect(db.rows("outbound_dms")[0].status).toBe("approved");
  });

  it("'I sent it' only works on an approved chat draft, and only once", async () => {
    expect((await markSentByHand(fakeClient(db), T, "c1", { userId: "u1" })).ok).toBe(false); // not approved yet
    await decideDraft(fakeClient(db), T, { dmId: "c1", action: "approve", expectedUpdatedAt: V }, { via: "in_app", userId: "u1" });
    const r = await markSentByHand(fakeClient(db), T, "c1", { userId: "u1" });
    expect(r).toMatchObject({ ok: true, status: "sent" });
    expect(db.rows("outbound_dms")[0].sent_at).toBeTruthy();
    expect((await markSentByHand(fakeClient(db), T, "c1", { userId: "u1" })).ok).toBe(true); // idempotent
  });

  it("refuses to mark an email as sent by hand", async () => {
    db.rows("outbound_dms")[0] = chatDm("c1", { channel: "email", to_email: "a@a.com", to_contact: null, status: "approved", send_via: "mailbox" });
    const r = await markSentByHand(fakeClient(db), T, "c1", { userId: "u1" });
    expect(r.ok).toBe(false);
    expect(db.rows("outbound_dms")[0].status).toBe("approved");
  });

  it("a member can only act on leads they own", async () => {
    const theirs = { ownerPersonId: "person-a" };
    const other = { ownerPersonId: "person-b" };
    expect((await decideDraft(fakeClient(db), T, { dmId: "c1", action: "approve", expectedUpdatedAt: V }, { via: "in_app", userId: "u2", scope: other })).ok).toBe(false);
    expect(db.rows("outbound_dms")[0].status).toBe("drafted");
    expect((await editDraft(fakeClient(db), T, { dmId: "c1", subject: "", body: "New", expectedUpdatedAt: V }, undefined, other)).ok).toBe(false);
    expect((await decideDraft(fakeClient(db), T, { dmId: "c1", action: "approve", expectedUpdatedAt: V }, { via: "in_app", userId: "u1", scope: theirs })).ok).toBe(true);
    expect((await unapproveDraft(fakeClient(db), T, "c1", other)).ok).toBe(false);
    expect((await markSentByHand(fakeClient(db), T, "c1", { userId: "u2", scope: other })).ok).toBe(false);
    expect((await markSentByHand(fakeClient(db), T, "c1", { userId: "u1", scope: theirs })).ok).toBe(true);
  });

  it("lists chat drafts with their channel and filters a member to their own leads", async () => {
    db.rows("prospects").push(prospect("p2", { owner_person_id: "person-b" }));
    db.rows("outbound_dms").push(chatDm("c2", { prospect_id: "p2" }));
    const all = await listReviewDrafts(fakeClient(db), T);
    expect(all.map((d) => d.id).sort()).toEqual(["c1", "c2"]);
    expect(all[0]).toMatchObject({ channel: "whatsapp", toContact: "+2348031234567" });
    const mine = await listReviewDrafts(fakeClient(db), T, { scope: { ownerPersonId: "person-b" } });
    expect(mine.map((d) => d.id)).toEqual(["c2"]);
  });

  it("chat drafts can be edited without a subject; emails still need one", async () => {
    expect((await editDraft(fakeClient(db), T, { dmId: "c1", subject: "", body: "Edited", expectedUpdatedAt: V })).ok).toBe(true);
    db.rows("outbound_dms").push(chatDm("e1", { channel: "email", to_email: "a@a.com", to_contact: null, subject: "Hi" }));
    expect((await editDraft(fakeClient(db), T, { dmId: "e1", subject: "", body: "Edited", expectedUpdatedAt: V })).ok).toBe(false);
  });
});

describe("chat import", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb({ prospects: [prospect("p1")], outbound_dms: [], inbound_messages: [] });
  });

  const msgs = [
    { from: "us" as const, text: "Hi Ada, we supply drinks for lounges.", at: "2026-11-27T10:00:00Z" },
    { from: "them" as const, text: "Do you deliver on Saturdays?", at: "2026-11-27T11:00:00Z" },
  ];

  it("matches the lead by phone, stores their messages, and drafts a WhatsApp reply", async () => {
    const r = await importChatAndDraft(fakeClient(db), T, { channel: "whatsapp", contact: "+234 803 123 4567", messages: msgs }, { writer, senderName: "Bola" });
    expect(r).toMatchObject({ ok: true, prospectId: "p1", stored: 1, noDraftReason: null });
    expect(db.rows("inbound_messages")).toHaveLength(1);
    expect(db.rows("prospects")[0].status).toBe("replied");
    const d = db.rows("outbound_dms")[0];
    expect(d).toMatchObject({ channel: "whatsapp", kind: "reply", status: "drafted", to_contact: "+2348031234567" });
    expect(d.send_via ?? null).toBeNull();
    expect(d.to_email).toBeUndefined();
  });

  it("uploading the same chat twice stores nothing new and keeps one draft", async () => {
    await importChatAndDraft(fakeClient(db), T, { channel: "whatsapp", contact: "08031234567", messages: msgs }, { writer, senderName: "Bola" });
    const again = await importChatAndDraft(fakeClient(db), T, { channel: "whatsapp", contact: "08031234567", messages: msgs }, { writer, senderName: "Bola" });
    expect(again).toMatchObject({ ok: true, stored: 0 });
    expect(db.rows("inbound_messages")).toHaveLength(1);
    expect(db.rows("outbound_dms")).toHaveLength(1);
  });

  it("a newer chat rewrites an approved-but-unsent draft back to draft", async () => {
    await importChatAndDraft(fakeClient(db), T, { channel: "whatsapp", contact: "08031234567", messages: msgs }, { writer, senderName: "Bola" });
    Object.assign(db.rows("outbound_dms")[0], { status: "approved", send_via: "by_hand" });
    const more = [...msgs, { from: "them" as const, text: "Also, what about Sundays?", at: "2026-11-27T12:00:00Z" }];
    await importChatAndDraft(fakeClient(db), T, { channel: "whatsapp", contact: "08031234567", messages: more }, { writer, senderName: "Bola" });
    expect(db.rows("outbound_dms")).toHaveLength(1);
    expect(db.rows("outbound_dms")[0]).toMatchObject({ status: "drafted", send_via: null });
  });

  it("no draft when we spoke last, the lead is closed, or nobody matches", async () => {
    const usLast = [...msgs, { from: "us" as const, text: "Yes we do.", at: "2026-11-27T12:00:00Z" }];
    const a = await importChatAndDraft(fakeClient(db), T, { channel: "whatsapp", contact: "08031234567", messages: usLast }, { writer, senderName: "Bola" });
    expect(a).toMatchObject({ ok: true, dmId: null });
    expect(db.rows("outbound_dms")).toHaveLength(0);

    db.rows("prospects")[0].status = "closed_lost";
    const b = await importChatAndDraft(fakeClient(db), T, { channel: "whatsapp", contact: "08031234567", messages: msgs }, { writer, senderName: "Bola" });
    expect(b).toMatchObject({ ok: true, dmId: null, noDraftReason: "This lead is closed" });

    const c = await importChatAndDraft(fakeClient(db), T, { channel: "whatsapp", contact: "+44 7700 900123", messages: msgs }, { writer, senderName: "Bola" });
    expect(c.ok).toBe(false);
  });

  it("never touches another tenant's lead, and a member can't import onto someone else's lead", async () => {
    const otherTenant = await importChatAndDraft(fakeClient(db), "gruve", { channel: "whatsapp", contact: "08031234567", messages: msgs, prospectId: "p1" }, { writer, senderName: "Bola" });
    expect(otherTenant.ok).toBe(false);
    const notMine = await importChatAndDraft(fakeClient(db), T, { channel: "whatsapp", contact: "08031234567", messages: msgs }, { writer, senderName: "Bola", ownerPersonId: "person-b" });
    expect(notMine.ok).toBe(false);
    expect(db.rows("inbound_messages")).toHaveLength(0);
  });

  it("instagram matches by handle and normalises the contact", async () => {
    expect(chatContact("instagram", "@P1")).toBe("p1");
    const r = await importChatAndDraft(fakeClient(db), T, { channel: "instagram", contact: "@p1", messages: msgs }, { writer, senderName: "Bola" });
    expect(r).toMatchObject({ ok: true, prospectId: "p1" });
    expect(db.rows("outbound_dms")[0]).toMatchObject({ channel: "instagram", to_contact: "p1" });
  });

  it("message ids are stable", () => {
    expect(chatMessageId("whatsapp", "+234", msgs[1])).toBe(chatMessageId("whatsapp", "+234", { ...msgs[1] }));
  });
});
