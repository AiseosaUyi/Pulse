import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";

// Track A Phase 3 verification (mandatory per the plan): two-tenant AI-away
// leak test, mirroring tests/integration/rls.test.ts's ghost-tenant
// pattern. Two real (throwaway) tenants with DIFFERENT
// settings.sharedInbox.autoSendConfidence and different content, run
// through the real maybeAutoReply() end-to-end (real admin DB reads/writes,
// real getSharedInboxConfig/shouldAiCover gates) — only the OpenAI call
// (generateEngagementReplyDraft) and the outbound dispatch (Composio/
// WhatsApp) are mocked at the network boundary, so the test is
// deterministic and never sends anything for real. Asserts neither
// tenant's config or draft content ever leaks into the other's row or
// send decision.
//
// engagement_items.sent_body/status are migration 102 columns. Per this
// repo's own convention (CLAUDE.md: migrations are pasted into the
// Supabase SQL Editor by hand, never auto-applied by a coding agent), skip
// with a loud, actionable message instead of a confusing column-not-found
// failure if 102 hasn't been applied to this Supabase project yet — same
// gate as tests/integration/whatsapp-webhook-upsert-fix.test.ts.
const migrationApplied = await (async () => {
  const { error } = await admin.from("engagement_items").select("sent_body").limit(1);
  return !error;
})();

if (!migrationApplied) {
  console.warn(
    "\n[shared-inbox-two-tenant-leak.test.ts] SKIPPED: migration 102 " +
      "(supabase/migrations/102_shared_inbox_conversations.sql) hasn't been " +
      "applied to this Supabase project yet — `engagement_items.sent_body` " +
      "doesn't exist. Paste migration 102 into the Supabase SQL Editor and " +
      "run it, then re-run this test file.\n"
  );
}

vi.mock("@/lib/ai/engagement-reply", () => ({
  generateEngagementReplyDraft: vi.fn(),
}));
vi.mock("@/lib/services/reply-dispatch", () => ({
  dispatchEngagementItemReply: vi.fn(),
  dispatchInboundMessageReply: vi.fn(),
}));

import { generateEngagementReplyDraft } from "@/lib/ai/engagement-reply";
import { dispatchEngagementItemReply, dispatchInboundMessageReply } from "@/lib/services/reply-dispatch";
import { maybeAutoReply } from "@/lib/ai/shared-inbox-auto-reply";

const suite = migrationApplied ? describe : describe.skip;

const RAND = Math.random().toString(36).slice(2, 8);
const TENANT_LOW = `sib-leak-low-${RAND}`; // autoSendConfidence: 0 — any confidence auto-sends
const TENANT_HIGH = `sib-leak-high-${RAND}`; // autoSendConfidence: 0.99 — this draft stays pending_review

function sharedInboxSettings(autoSendConfidence: number) {
  return {
    sharedInbox: {
      enabled: true,
      alwaysOn: true, // skip office-hours entirely — deterministic "always covering"
      autoSendConfidence,
      timezone: "UTC",
      officeHours: [],
    },
  };
}

suite("Track A Phase 3: two-tenant AI-away config/leak isolation", () => {
  let rowLowId: string;
  let rowHighId: string;

  beforeAll(async () => {
    const { error: tErr } = await admin.from("tenants").insert([
      { slug: TENANT_LOW, name: "Leak Test Low-Bar Co", settings: sharedInboxSettings(0) },
      { slug: TENANT_HIGH, name: "Leak Test High-Bar Co", settings: sharedInboxSettings(0.99) },
    ]);
    if (tErr) throw tErr;

    const { data: rows, error: iErr } = await admin
      .from("engagement_items")
      .insert([
        {
          tenant_slug: TENANT_LOW,
          type: "comment",
          platform: "instagram",
          from_name: "Low Bar Customer",
          from_handle: "@low_bar_customer",
          content: "Do you deliver to Lekki?",
          external_id: `leak-low-${RAND}`,
        },
        {
          tenant_slug: TENANT_HIGH,
          type: "comment",
          platform: "instagram",
          from_name: "High Bar Customer",
          from_handle: "@high_bar_customer",
          content: "Do you deliver to Ikeja?",
          external_id: `leak-high-${RAND}`,
        },
      ])
      .select("id, tenant_slug");
    if (iErr) throw iErr;
    rowLowId = rows!.find((r) => r.tenant_slug === TENANT_LOW)!.id;
    rowHighId = rows!.find((r) => r.tenant_slug === TENANT_HIGH)!.id;

    // Deterministic "AI": echoes the tenant name + inbound content back so
    // we can assert each row's draft only ever reflects its OWN tenant's
    // input, never the other's. Real confidenceScore stays fixed at 0.9 —
    // whether it auto-sends is entirely a function of each tenant's own
    // autoSendConfidence, which is the thing under test.
    vi.mocked(generateEngagementReplyDraft).mockImplementation(async (input) => ({
      body: `Reply from ${input.tenantName}: re "${input.item.content}"`,
      confidence: "high",
      confidenceScore: 0.9,
    }));
    vi.mocked(dispatchEngagementItemReply).mockResolvedValue({ success: true });
    vi.mocked(dispatchInboundMessageReply).mockResolvedValue({ success: true });
  });

  afterAll(async () => {
    // Cascades delete the engagement_items rows too (tenant_slug FK is
    // `on delete cascade`).
    await admin.from("tenants").delete().in("slug", [TENANT_LOW, TENANT_HIGH]);
  });

  it("drafts and sends independently per tenant, with no cross-tenant leakage", async () => {
    // Run concurrently — a shared/global-state leak between tenants would
    // most plausibly show up under concurrent execution, not sequential.
    const [resultLow, resultHigh] = await Promise.all([
      maybeAutoReply({
        source: "engagement",
        id: rowLowId,
        tenantSlug: TENANT_LOW,
        platform: "instagram",
        type: "comment",
        content: "Do you deliver to Lekki?",
        fromHandle: "@low_bar_customer",
        externalId: `leak-low-${RAND}`,
        meta: null,
        receivedAt: new Date().toISOString(),
      }),
      maybeAutoReply({
        source: "engagement",
        id: rowHighId,
        tenantSlug: TENANT_HIGH,
        platform: "instagram",
        type: "comment",
        content: "Do you deliver to Ikeja?",
        fromHandle: "@high_bar_customer",
        externalId: `leak-high-${RAND}`,
        meta: null,
        receivedAt: new Date().toISOString(),
      }),
    ]);

    // Draft generation was called once per tenant, with each call's own
    // tenant identity — never the other tenant's.
    expect(generateEngagementReplyDraft).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(generateEngagementReplyDraft).mock.calls;
    const lowCall = calls.find((c) => c[0].tenantSlug === TENANT_LOW);
    const highCall = calls.find((c) => c[0].tenantSlug === TENANT_HIGH);
    expect(lowCall?.[0].tenantName).toBe("Leak Test Low-Bar Co");
    expect(lowCall?.[0].item.content).toBe("Do you deliver to Lekki?");
    expect(highCall?.[0].tenantName).toBe("Leak Test High-Bar Co");
    expect(highCall?.[0].item.content).toBe("Do you deliver to Ikeja?");

    // Low-bar tenant (threshold 0): confidenceScore 0.9 clears it — sent.
    expect(resultLow.outcome).toBe("sent");
    expect(resultLow.sent).toBe(true);

    // High-bar tenant (threshold 0.99): same 0.9 confidenceScore does NOT
    // clear it — stays pending_review, never sent. If tenant isolation
    // were broken (e.g. the low tenant's threshold leaked in), this would
    // incorrectly also come back "sent".
    expect(resultHigh.outcome).toBe("drafted_below_threshold");
    expect(resultHigh.sent).toBe(false);

    // Dispatch was invoked exactly once, and only for the low-bar tenant.
    expect(dispatchEngagementItemReply).toHaveBeenCalledTimes(1);
    expect(dispatchEngagementItemReply).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_slug: TENANT_LOW }),
      expect.stringContaining("Leak Test Low-Bar Co")
    );

    // Row-level assertions: each row's persisted draft/state reflects only
    // its own tenant, and the two never got swapped.
    const { data: rowLow } = await admin
      .from("engagement_items")
      .select("ai_draft, approval_status, sent_body, approved_by")
      .eq("id", rowLowId)
      .single();
    expect(rowLow?.approval_status).toBe("sent");
    expect(rowLow?.sent_body).toContain("Leak Test Low-Bar Co");
    expect(rowLow?.sent_body).not.toContain("High-Bar");
    expect(rowLow?.approved_by).toBeNull(); // AI-authored signal

    const { data: rowHigh } = await admin
      .from("engagement_items")
      .select("ai_draft, approval_status, sent_body, approved_by")
      .eq("id", rowHighId)
      .single();
    expect(rowHigh?.approval_status).toBe("pending_review");
    expect(rowHigh?.sent_body).toBeNull(); // never sent
    expect((rowHigh?.ai_draft as { body?: string } | null)?.body).toContain("Leak Test High-Bar Co");
    expect((rowHigh?.ai_draft as { body?: string } | null)?.body).not.toContain("Low-Bar");
  });
});
