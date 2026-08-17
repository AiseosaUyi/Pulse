import { describe, it, expect } from "vitest";
import {
  engagementItemParticipantKey,
  inboundMessageParticipantKey,
  sourceForPlatform,
  buildConversationId,
  parseConversationId,
  deriveReply,
} from "@/lib/services/conversations";

describe("engagementItemParticipantKey", () => {
  it("prefers meta.sender_id when present", () => {
    const key = engagementItemParticipantKey({
      meta: { sender_id: "IG-123" },
      fromHandle: "@someone",
      fromName: "Someone",
    });
    expect(key).toBe("ig-123");
  });

  it("falls back to from_handle when no sender_id", () => {
    const key = engagementItemParticipantKey({
      meta: null,
      fromHandle: "@Someone",
      fromName: "Someone Else",
    });
    expect(key).toBe("@someone");
  });

  it("falls back to from_name when no sender_id or handle", () => {
    const key = engagementItemParticipantKey({
      meta: null,
      fromHandle: null,
      fromName: "Jane Doe",
    });
    expect(key).toBe("jane doe");
  });

  it("is lowercased and trimmed for grouping stability", () => {
    const a = engagementItemParticipantKey({ meta: null, fromHandle: "  @Foo  ", fromName: null });
    const b = engagementItemParticipantKey({ meta: null, fromHandle: "@foo", fromName: null });
    expect(a).toBe(b);
  });

  it("returns empty string when nothing identifies the sender", () => {
    const key = engagementItemParticipantKey({ meta: null, fromHandle: null, fromName: null });
    expect(key).toBe("");
  });
});

describe("inboundMessageParticipantKey", () => {
  it("prefers from_handle (the WhatsApp phone number)", () => {
    const key = inboundMessageParticipantKey({
      fromHandle: "2348030001111",
      prospectId: "prospect-1",
      id: "row-1",
    });
    expect(key).toBe("2348030001111");
  });

  it("falls back to prospect_id when no handle", () => {
    const key = inboundMessageParticipantKey({
      fromHandle: null,
      prospectId: "prospect-1",
      id: "row-1",
    });
    expect(key).toBe("prospect:prospect-1");
  });

  it("falls back to the row id as a last resort (ungroupable singleton)", () => {
    const key = inboundMessageParticipantKey({
      fromHandle: null,
      prospectId: null,
      id: "row-1",
    });
    expect(key).toBe("msg:row-1");
  });
});

describe("sourceForPlatform / conversation id round-trip", () => {
  it("routes whatsapp to the whatsapp source, everything else to engagement", () => {
    expect(sourceForPlatform("whatsapp")).toBe("whatsapp");
    expect(sourceForPlatform("instagram")).toBe("engagement");
    expect(sourceForPlatform("linkedin")).toBe("engagement");
  });

  it("builds and parses a conversation id losslessly", () => {
    const id = buildConversationId("instagram", "some.handle");
    expect(id).toBe("instagram::some.handle");
    expect(parseConversationId(id)).toEqual({
      platform: "instagram",
      participantKey: "some.handle",
    });
  });

  it("returns null for a malformed conversation id", () => {
    expect(parseConversationId("not-a-valid-id")).toBeNull();
  });

  it("preserves participant keys that themselves contain '::'-adjacent characters", () => {
    // participantKey is joined back verbatim after the first "::" split
    const id = buildConversationId("whatsapp", "234803:0001111");
    expect(parseConversationId(id)).toEqual({
      platform: "whatsapp",
      participantKey: "234803:0001111",
    });
  });
});

describe("deriveReply", () => {
  it("returns null when no reply has been sent", () => {
    expect(
      deriveReply({ sentBody: null, approvedBy: null, approvedAt: null, receivedAt: "2026-01-01T00:00:00Z" })
    ).toBeNull();
  });

  it("derives 'human' when approved_by is set", () => {
    const reply = deriveReply({
      sentBody: "Thanks!",
      approvedBy: "user-123",
      approvedAt: "2026-01-01T01:00:00Z",
      receivedAt: "2026-01-01T00:00:00Z",
    });
    expect(reply).toEqual({ body: "Thanks!", sentBy: "human", at: "2026-01-01T01:00:00Z" });
  });

  it("derives 'ai_auto' when approved_by is null (the AI-vs-human signal)", () => {
    const reply = deriveReply({
      sentBody: "Auto reply",
      approvedBy: null,
      approvedAt: "2026-01-01T01:00:00Z",
      receivedAt: "2026-01-01T00:00:00Z",
    });
    expect(reply?.sentBy).toBe("ai_auto");
  });

  it("falls back to receivedAt when approvedAt is missing", () => {
    const reply = deriveReply({
      sentBody: "Reply",
      approvedBy: "user-1",
      approvedAt: null,
      receivedAt: "2026-01-01T00:00:00Z",
    });
    expect(reply?.at).toBe("2026-01-01T00:00:00Z");
  });
});
