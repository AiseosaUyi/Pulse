import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, signInAsSeedUser } from "../helpers/clients";

// Role-isolation test for Track A Phase 4's `support` role (migration 103,
// supabase/migrations/103_support_role.sql). Unlike rls.test.ts (which
// tests cross-TENANT isolation via a ghost tenant), this tests ROLE
// isolation WITHIN a single tenant: a `support`-role membership must keep
// full read/write access to engagement_items and inbound_messages
// (identical to every other role — that's the whole point of the role),
// while being blocked from every other tenant-scoped business-data table
// by migration 103's new `is_support_member()` restrictive policies.
//
// Migration 103 widens memberships.role's CHECK constraint to allow
// 'support' as its LAST step, deliberately — the restrictive policies
// gate first, the role that could exploit their absence arrives second
// (see the migration's own header comment). Per this task's explicit
// instruction, migration 103 was NOT applied to any database as part of
// this work — it changes tenant-wide RLS access and needs its own
// separate, explicit approval checkpoint. Until it's applied, a
// role='support' membership row can't even be inserted (the CHECK
// constraint rejects it), so this whole file skips with a loud,
// actionable message instead of failing on a constraint violation —
// mirrors the exact gating pattern whatsapp-webhook-upsert-fix.test.ts
// uses for migration 102.

const PROBE_TENANT = `rls-role-probe-${Math.random().toString(36).slice(2, 8)}`;

const migrationApplied = await (async () => {
  const probeUser = await signInAsSeedUser();
  const { data } = await probeUser.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return false;

  const { error: tErr } = await admin
    .from("tenants")
    .insert({ slug: PROBE_TENANT, name: "RLS Role Probe" });
  if (tErr) return false;

  const { error: mErr } = await admin
    .from("memberships")
    .insert({ user_id: userId, tenant_slug: PROBE_TENANT, role: "support" });

  // Cascades the probe membership row too (memberships.tenant_slug FK is
  // ON DELETE CASCADE) — clean either way, applied or not.
  await admin.from("tenants").delete().eq("slug", PROBE_TENANT);

  return !mErr;
})();

if (!migrationApplied) {
  console.warn(
    "\n[support-role-rls.test.ts] SKIPPED: migration 103 " +
      "(supabase/migrations/103_support_role.sql) hasn't been applied to " +
      "this Supabase project yet — memberships.role's CHECK constraint " +
      "doesn't allow 'support'. This migration changes RLS access for " +
      "every tenant and needs its own explicit sign-off — paste it into " +
      "the Supabase SQL Editor and run it, then re-run this test file.\n"
  );
}

const GHOST = `rls-role-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!migrationApplied)("RLS: support role is scoped to conversations data only", () => {
  let user: SupabaseClient;
  let userId: string;

  beforeAll(async () => {
    user = await signInAsSeedUser();
    const { data } = await user.auth.getUser();
    userId = data.user!.id;

    const { error: tErr } = await admin
      .from("tenants")
      .insert({ slug: GHOST, name: "RLS Role Ghost" });
    if (tErr) throw tErr;

    // Give the seed user a 'support' membership scoped to THIS tenant only
    // — their existing gruve/sippy memberships (whatever role they hold
    // there) are untouched, so this exercises exactly the per-tenant-row
    // scoping is_support_member() relies on.
    const { error: mErr } = await admin
      .from("memberships")
      .insert({ user_id: userId, tenant_slug: GHOST, role: "support" });
    if (mErr) throw mErr;

    const { error: eErr } = await admin.from("engagement_items").insert({
      tenant_slug: GHOST,
      type: "dm",
      platform: "instagram",
      from_name: "Ghost Customer",
      content: "hi",
    });
    if (eErr) throw eErr;

    const { error: iErr } = await admin.from("inbound_messages").insert({
      tenant_slug: GHOST,
      platform: "whatsapp",
      body: "hi",
    });
    if (iErr) throw iErr;

    const { error: lErr } = await admin.from("leads").insert({
      tenant_slug: GHOST,
      name: "Ghost Lead",
      type: "venue",
      status: "new",
    });
    if (lErr) throw lErr;

    const { error: pErr } = await admin.from("own_post_metrics").insert({
      tenant_slug: GHOST,
      platform: "instagram",
      source: "manual",
      metrics: { likes: 100 },
    });
    if (pErr) throw pErr;
  });

  afterAll(async () => {
    await admin.from("tenants").delete().eq("slug", GHOST);
  });

  it("support role reads engagement_items for its tenant (same access as every other role)", async () => {
    const { data, error } = await user.from("engagement_items").select("id").eq("tenant_slug", GHOST);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("support role writes engagement_items for its tenant", async () => {
    const { error } = await user.from("engagement_items").insert({
      tenant_slug: GHOST,
      type: "dm",
      platform: "instagram",
      from_name: "From Support",
      content: "support reply",
    });
    expect(error).toBeNull();
  });

  it("support role reads inbound_messages for its tenant", async () => {
    const { data, error } = await user.from("inbound_messages").select("id").eq("tenant_slug", GHOST);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("support role writes inbound_messages for its tenant", async () => {
    const { error } = await user.from("inbound_messages").insert({
      tenant_slug: GHOST,
      platform: "whatsapp",
      body: "support inbound test",
    });
    expect(error).toBeNull();
  });

  it("support role CANNOT read leads for its own tenant (restrictive policy blocks it)", async () => {
    const { data, error } = await user.from("leads").select("id").eq("tenant_slug", GHOST);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("support role CANNOT insert leads for its own tenant", async () => {
    const { error } = await user.from("leads").insert({
      tenant_slug: GHOST,
      name: "Support Intruder",
      type: "venue",
      status: "new",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501"); // insufficient_privilege (RLS denial)
  });

  it("support role CANNOT read own_post_metrics for its own tenant", async () => {
    const { data, error } = await user.from("own_post_metrics").select("id").eq("tenant_slug", GHOST);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
