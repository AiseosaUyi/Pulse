import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeSupabase, type FakeTables } from "../helpers/fake-supabase";

// sendInboundMessageReply (lib/actions/inbound-messages.ts) exercised
// end-to-end through its real dispatch logic (lib/services/reply-dispatch.ts
// dispatchInboundMessageReply), with only the Meta Graph API boundary
// mocked (getWhatsappAccount / sendWhatsappText) — never a real network
// call. Auth + DB are mocked too since "use server" action files call
// next/headers cookies() via src/lib/supabase/server.ts, which throws
// outside a real Next.js request scope (confirmed empirically; no
// existing test in this repo calls an action file directly for the same
// reason — see tests/unit/publish-to-gruve-richtext.test.ts for the same
// full-mock pattern applied to a different action).

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  getCurrentTenant: vi.fn().mockResolvedValue({ slug: "ghost-tenant" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/integrations/whatsapp", () => ({
  getWhatsappAccount: vi.fn(),
  sendWhatsappText: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getWhatsappAccount, sendWhatsappText } from "@/lib/integrations/whatsapp";
import { sendInboundMessageReply } from "@/lib/actions/inbound-messages";

const ACCOUNT = {
  tenantSlug: "ghost-tenant",
  phoneNumberId: "test-phone-id",
  accessToken: "test-token",
};

function seedTables(): FakeTables {
  return {
    inbound_messages: [
      {
        id: "msg-1",
        tenant_slug: "ghost-tenant",
        platform: "whatsapp",
        from_handle: "2348030001111",
        body: "Hello",
        sent_body: null,
        approval_status: null,
        approved_by: null,
        approved_at: null,
      },
      {
        id: "msg-instagram",
        tenant_slug: "ghost-tenant",
        platform: "instagram",
        from_handle: "@someone",
        body: "Hey there",
        sent_body: null,
        approval_status: null,
        approved_by: null,
        approved_at: null,
      },
      {
        id: "msg-no-handle",
        tenant_slug: "ghost-tenant",
        platform: "whatsapp",
        from_handle: null,
        body: "Hello",
        sent_body: null,
        approval_status: null,
        approved_by: null,
        approved_at: null,
      },
    ],
  };
}

let tables: FakeTables;

beforeEach(() => {
  tables = seedTables();
  vi.mocked(createClient).mockResolvedValue(makeFakeSupabase(tables) as never);
  vi.mocked(getWhatsappAccount).mockReset();
  vi.mocked(sendWhatsappText).mockReset();
});

describe("sendInboundMessageReply", () => {
  it("sends via WhatsApp and persists sent_body/approval_status/approved_by/approved_at", async () => {
    vi.mocked(getWhatsappAccount).mockResolvedValue(ACCOUNT);
    vi.mocked(sendWhatsappText).mockResolvedValue({ ok: true, messageId: "wamid.sent-1" });

    const result = await sendInboundMessageReply("msg-1", "Hi! Yes, still available.");

    expect(result.success).toBe(true);
    expect(sendWhatsappText).toHaveBeenCalledWith(ACCOUNT, "2348030001111", "Hi! Yes, still available.");

    const row = tables.inbound_messages.find((r) => r.id === "msg-1")!;
    expect(row.sent_body).toBe("Hi! Yes, still available.");
    expect(row.approval_status).toBe("sent");
    expect(row.approved_by).toBe("user-1");
    expect(row.approved_at).toBeTruthy();
  });

  it("surfaces a Graph API failure without writing sent_body (nothing persists on failure)", async () => {
    vi.mocked(getWhatsappAccount).mockResolvedValue(ACCOUNT);
    vi.mocked(sendWhatsappText).mockResolvedValue({ ok: false, error: "window closed" });

    const result = await sendInboundMessageReply("msg-1", "Still there?");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("window closed");

    const row = tables.inbound_messages.find((r) => r.id === "msg-1")!;
    expect(row.sent_body).toBeNull();
  });

  it("fails with no_account when no WhatsApp number is connected", async () => {
    vi.mocked(getWhatsappAccount).mockResolvedValue(null);

    const result = await sendInboundMessageReply("msg-1", "Hi");

    expect(result.success).toBe(false);
    expect(sendWhatsappText).not.toHaveBeenCalled();
  });

  it("rejects replying to a non-whatsapp row from this inbox", async () => {
    const result = await sendInboundMessageReply("msg-instagram", "Hi");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/instagram/i);
    expect(sendWhatsappText).not.toHaveBeenCalled();
  });

  it("rejects a row with no sender phone number on record", async () => {
    const result = await sendInboundMessageReply("msg-no-handle", "Hi");
    expect(result.success).toBe(false);
    expect(sendWhatsappText).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    const result = await sendInboundMessageReply("msg-1", "   ");
    expect(result.success).toBe(false);
    expect(sendWhatsappText).not.toHaveBeenCalled();
  });
});
