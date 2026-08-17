import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeSupabase, type FakeTables } from "../helpers/fake-supabase";

// assignConversation / setConversationStatus (lib/actions/inbound-messages.ts)
// — the bulk-update-by-participant-key pattern, for both source tables
// (WhatsApp -> inbound_messages, everything else -> engagement_items). Same
// full-mock rationale as inbound-messages-send.test.ts: "use server" action
// files need next/headers cookies(), which throws outside a real Next.js
// request scope.

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  getCurrentTenant: vi.fn().mockResolvedValue({ slug: "ghost-tenant" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import {
  assignConversation,
  setConversationStatus,
} from "@/lib/actions/inbound-messages";
import { buildConversationId } from "@/lib/services/conversations";

function seedTables(): FakeTables {
  return {
    inbound_messages: [
      {
        id: "wa-1",
        tenant_slug: "ghost-tenant",
        platform: "whatsapp",
        from_handle: "2348030001111",
        prospect_id: null,
        status: "open",
        assigned_to: null,
        received_at: new Date().toISOString(),
      },
      {
        id: "wa-2",
        tenant_slug: "ghost-tenant",
        platform: "whatsapp",
        from_handle: "2348030001111",
        prospect_id: null,
        status: "open",
        assigned_to: null,
        received_at: new Date().toISOString(),
      },
      // Different sender — must never be touched by an action scoped to
      // the 2348030001111 conversation.
      {
        id: "wa-other",
        tenant_slug: "ghost-tenant",
        platform: "whatsapp",
        from_handle: "2348030009999",
        prospect_id: null,
        status: "open",
        assigned_to: null,
        received_at: new Date().toISOString(),
      },
    ],
    engagement_items: [
      {
        id: "eng-1",
        tenant_slug: "ghost-tenant",
        platform: "instagram",
        from_handle: "@handle",
        from_name: "Handle",
        meta: null,
        status: "open",
        assigned_to: null,
        received_at: new Date().toISOString(),
      },
      {
        id: "eng-2",
        tenant_slug: "ghost-tenant",
        platform: "instagram",
        from_handle: "@handle",
        from_name: "Handle",
        meta: null,
        status: "open",
        assigned_to: null,
        received_at: new Date().toISOString(),
      },
      {
        id: "eng-other",
        tenant_slug: "ghost-tenant",
        platform: "instagram",
        from_handle: "@someone-else",
        from_name: "Someone Else",
        meta: null,
        status: "open",
        assigned_to: null,
        received_at: new Date().toISOString(),
      },
    ],
  };
}

let tables: FakeTables;

beforeEach(() => {
  tables = seedTables();
  vi.mocked(createClient).mockResolvedValue(makeFakeSupabase(tables) as never);
});

describe("assignConversation", () => {
  it("assigns every row in a WhatsApp conversation to the caller ('me'), leaving other senders untouched", async () => {
    const id = buildConversationId("whatsapp", "2348030001111");
    const result = await assignConversation(id, "me");
    expect(result.success).toBe(true);

    const wa1 = tables.inbound_messages.find((r) => r.id === "wa-1")!;
    const wa2 = tables.inbound_messages.find((r) => r.id === "wa-2")!;
    const waOther = tables.inbound_messages.find((r) => r.id === "wa-other")!;
    expect(wa1.assigned_to).toBe("user-1");
    expect(wa2.assigned_to).toBe("user-1");
    expect(waOther.assigned_to).toBeNull();
  });

  it("assigns every row in an engagement conversation, leaving other participants untouched", async () => {
    const id = buildConversationId("instagram", "@handle");
    const result = await assignConversation(id, "me");
    expect(result.success).toBe(true);

    const eng1 = tables.engagement_items.find((r) => r.id === "eng-1")!;
    const eng2 = tables.engagement_items.find((r) => r.id === "eng-2")!;
    const engOther = tables.engagement_items.find((r) => r.id === "eng-other")!;
    expect(eng1.assigned_to).toBe("user-1");
    expect(eng2.assigned_to).toBe("user-1");
    expect(engOther.assigned_to).toBeNull();
  });

  it("unassigns (assignee = null)", async () => {
    tables.inbound_messages.forEach((r) => {
      if (r.from_handle === "2348030001111") r.assigned_to = "user-1";
    });
    const id = buildConversationId("whatsapp", "2348030001111");
    const result = await assignConversation(id, null);
    expect(result.success).toBe(true);
    expect(tables.inbound_messages.find((r) => r.id === "wa-1")!.assigned_to).toBeNull();
  });

  it("fails on a malformed conversation id", async () => {
    const result = await assignConversation("not-valid", "me");
    expect(result.success).toBe(false);
  });
});

describe("setConversationStatus", () => {
  it("resolves every row in a conversation across both tables independently", async () => {
    const waId = buildConversationId("whatsapp", "2348030001111");
    const waResult = await setConversationStatus(waId, "resolved");
    expect(waResult.success).toBe(true);
    expect(tables.inbound_messages.find((r) => r.id === "wa-1")!.status).toBe("resolved");
    expect(tables.inbound_messages.find((r) => r.id === "wa-2")!.status).toBe("resolved");
    expect(tables.inbound_messages.find((r) => r.id === "wa-other")!.status).toBe("open");

    const engId = buildConversationId("instagram", "@handle");
    const engResult = await setConversationStatus(engId, "resolved");
    expect(engResult.success).toBe(true);
    expect(tables.engagement_items.find((r) => r.id === "eng-1")!.status).toBe("resolved");
    expect(tables.engagement_items.find((r) => r.id === "eng-other")!.status).toBe("open");
  });

  it("reopens a resolved conversation", async () => {
    tables.inbound_messages.forEach((r) => {
      if (r.from_handle === "2348030001111") r.status = "resolved";
    });
    const id = buildConversationId("whatsapp", "2348030001111");
    const result = await setConversationStatus(id, "open");
    expect(result.success).toBe(true);
    expect(tables.inbound_messages.find((r) => r.id === "wa-1")!.status).toBe("open");
  });
});
