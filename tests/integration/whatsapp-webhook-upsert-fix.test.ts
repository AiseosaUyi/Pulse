import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";

// Regression test for Track A's crux bug #1: the WhatsApp webhook's
// inbound_messages upsert targeted `onConflict: "tenant_slug,platform,
// external_id"` with no matching unique index — every inbound WhatsApp
// message has been silently failing to persist since the webhook shipped.
// Migration 102 adds the missing index (`uq_inbound_messages_external`)
// and `from_handle`; this test posts a synthetic webhook payload through
// the real route handler and proves both are fixed: the upsert succeeds
// (twice, to prove it's idempotent on conflict, not just insert-once) and
// `from_handle` is populated on the resulting row.

// Migration 102 is schema-only and, per this repo's own convention
// (CLAUDE.md: "the user typically runs migrations by hand in the SQL
// Editor"), is never auto-applied by a coding agent — it's a named
// checkpoint requiring explicit sign-off. If it hasn't been pasted into
// the Supabase SQL Editor yet, `from_handle` won't exist on the live dev
// DB and every assertion below would fail for an environment reason, not
// a code regression. Detect that up front and skip with a loud, actionable
// message instead of a confusing column-not-found failure.
const migrationApplied = await (async () => {
  const { error } = await admin.from("inbound_messages").select("from_handle").limit(1);
  return !error;
})();

if (!migrationApplied) {
  console.warn(
    "\n[whatsapp-webhook-upsert-fix.test.ts] SKIPPED: migration 102 " +
      "(supabase/migrations/102_shared_inbox_conversations.sql) hasn't been " +
      "applied to this Supabase project yet — `inbound_messages.from_handle` " +
      "doesn't exist. Paste migration 102 into the Supabase SQL Editor and " +
      "run it, then re-run this test file.\n"
  );
}

const GHOST = `wa-webhook-${Math.random().toString(36).slice(2, 8)}`;
const PHONE_NUMBER_ID = `test-phone-${Math.random().toString(36).slice(2, 8)}`;
const SENDER = "2348030001111";
const MESSAGE_ID = `wamid.test-${Math.random().toString(36).slice(2, 10)}`;

let POST: typeof import("../../src/app/api/integrations/whatsapp/route").POST;

function webhookPayload(text: string) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              messages: [
                {
                  from: SENDER,
                  id: MESSAGE_ID,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function makeRequest(body: unknown): Request {
  return new Request("https://test.local/api/integrations/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!migrationApplied)("WhatsApp webhook: inbound_messages upsert (crux bug #1 regression)", () => {
  beforeAll(async () => {
    POST = (await import("../../src/app/api/integrations/whatsapp/route")).POST;

    const { error: tErr } = await admin
      .from("tenants")
      .insert({ slug: GHOST, name: "WA Webhook Ghost" });
    if (tErr) throw tErr;

    const { error: aErr } = await admin.from("whatsapp_accounts").insert({
      tenant_slug: GHOST,
      phone_number_id: PHONE_NUMBER_ID,
      access_token: "test-access-token",
    });
    if (aErr) throw aErr;
  });

  afterAll(async () => {
    await admin.from("tenants").delete().eq("slug", GHOST);
  });

  it("ingests an inbound message and populates from_handle", async () => {
    const res = await POST(makeRequest(webhookPayload("hello from a customer")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ingested).toBe(1);
    expect(body.unmatched).toBe(0);

    const { data, error } = await admin
      .from("inbound_messages")
      .select("id, tenant_slug, platform, channel, external_id, body, from_handle")
      .eq("tenant_slug", GHOST)
      .eq("external_id", MESSAGE_ID)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.platform).toBe("whatsapp");
    expect(data?.channel).toBe("whatsapp");
    expect(data?.from_handle).toBe(SENDER);
    expect(data?.body).toBe("hello from a customer");
  });

  it("upserts idempotently on the same external_id (no missing-index error)", async () => {
    // Re-post the same wamid — before migration 102 this `onConflict`
    // target had no matching unique index and every upsert errored
    // silently (ingested would report 0, not 1, and the row would never
    // update). This is the exact bug the migration's header comment
    // describes.
    const res = await POST(makeRequest(webhookPayload("edited resend of the same message")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ingested).toBe(1);

    const { data, error } = await admin
      .from("inbound_messages")
      .select("id")
      .eq("tenant_slug", GHOST)
      .eq("external_id", MESSAGE_ID);

    expect(error).toBeNull();
    // Still exactly one row for this external_id — proves the upsert
    // updated in place rather than erroring or duplicating.
    expect(data ?? []).toHaveLength(1);
  });

  it("ignores messages for a phone number not connected to any tenant", async () => {
    const res = await POST(
      makeRequest({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "unknown-phone-id-does-not-exist" },
                  messages: [
                    {
                      from: SENDER,
                      id: `wamid.unmatched-${Math.random().toString(36).slice(2, 8)}`,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      text: { body: "should not be ingested" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ingested).toBe(0);
    expect(body.unmatched).toBe(1);
  });
});
