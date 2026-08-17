import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";

// Track A Phase 3 — eng-review-added gap: maybeAutoReply()'s OpenAI-failure
// branch (timeout / misconfiguration) has error handling in the design but
// had no dedicated test. This forces a REAL failure through the REAL
// generateEngagementReplyDraft (only the underlying `generateText` call
// from the `ai` package is mocked to reject — engagement-reply.ts's own
// try/catch + logAiCall(success:false) run for real) and asserts:
//   1. The engagement_items row is left completely undrafted — no partial
//      ai_draft/approval_status write.
//   2. logAiCall recorded the failure in ai_call_log.
// Real ghost tenant + row via the admin client, same pattern as
// tests/integration/rls.test.ts.

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn().mockRejectedValue(new Error("SIMULATED_FORCED_FAILURE: shared-inbox-auto-reply-failure.test.ts")),
  };
});

import { maybeAutoReply } from "@/lib/ai/shared-inbox-auto-reply";

const RAND = Math.random().toString(36).slice(2, 8);
const GHOST = `sib-fail-${RAND}`;

describe("Track A Phase 3: maybeAutoReply — forced AI draft failure", () => {
  let rowId: string;

  beforeAll(async () => {
    const { error: tErr } = await admin.from("tenants").insert({
      slug: GHOST,
      name: "Auto-Reply Failure Ghost",
      settings: {
        sharedInbox: {
          enabled: true,
          alwaysOn: true, // skip office-hours gate entirely — deterministic "always covering"
          autoSendConfidence: 0.5,
          timezone: "UTC",
          officeHours: [],
        },
      },
    });
    if (tErr) throw tErr;

    const { data: row, error: iErr } = await admin
      .from("engagement_items")
      .insert({
        tenant_slug: GHOST,
        type: "comment",
        platform: "instagram",
        from_name: "Failure Test Customer",
        from_handle: "@failure_test_customer",
        content: "Is this still in stock?",
        external_id: `fail-${RAND}`,
      })
      .select("id")
      .single();
    if (iErr) throw iErr;
    rowId = row!.id;
  });

  afterAll(async () => {
    // Cascades delete the engagement_items row too (tenant_slug FK is
    // `on delete cascade`). ai_call_log rows for this ghost tenant are
    // left for the same reason rls.test.ts leaves its own — cheap,
    // harmless, tenant-scoped rows with no FK back to anything real.
    await admin.from("tenants").delete().eq("slug", GHOST);
  });

  it("leaves the row completely undrafted on a forced OpenAI failure (no partial write)", async () => {
    const result = await maybeAutoReply({
      source: "engagement",
      id: rowId,
      tenantSlug: GHOST,
      platform: "instagram",
      type: "comment",
      content: "Is this still in stock?",
      fromHandle: "@failure_test_customer",
      externalId: `fail-${RAND}`,
      meta: null,
      receivedAt: new Date().toISOString(),
    });

    expect(result.outcome).toBe("draft_failed");
    expect(result.drafted).toBe(false);
    expect(result.sent).toBe(false);

    // sent_body/status are migration-102 columns (see
    // shared-inbox-two-tenant-leak.test.ts's gate) — not needed for this
    // assertion, which only cares about the migration-057 approval-queue
    // columns staying untouched, so this test runs regardless of whether
    // 102 has been applied yet.
    const { data: row, error } = await admin
      .from("engagement_items")
      .select("ai_draft, approval_status")
      .eq("id", rowId)
      .single();
    expect(error).toBeNull();
    expect(row?.ai_draft).toBeNull();
    expect(row?.approval_status).toBeNull();
  });

  it("records the failure in ai_call_log via logAiCall", async () => {
    const { data, error } = await admin
      .from("ai_call_log")
      .select("id, purpose, feature, success, error_message")
      .eq("tenant_slug", GHOST)
      .eq("success", false);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(data![0].purpose).toBe("synthesis");
    expect(data![0].feature).toBe("engagement_reply_draft");
    expect(data![0].error_message).toContain("SIMULATED_FORCED_FAILURE");
  });
});
