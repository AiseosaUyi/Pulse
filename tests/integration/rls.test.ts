import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, signInAsSeedUser } from "../helpers/clients";

// End-to-end RLS check: the seed user is a member of `gruve` + `sippy`
// only. We create a ghost tenant they don't belong to, drop a row into it,
// then verify the authed user can't read it or write to it.

const GHOST = `rls-ghost-${Math.random().toString(36).slice(2, 8)}`;

describe("RLS: cross-tenant isolation", () => {
  let user: SupabaseClient;

  beforeAll(async () => {
    user = await signInAsSeedUser();

    const { error: tErr } = await admin
      .from("tenants")
      .insert({ slug: GHOST, name: "RLS Ghost" });
    if (tErr) throw tErr;

    const { error: lErr } = await admin.from("leads").insert({
      tenant_slug: GHOST,
      name: "Ghost Lead",
      type: "venue",
      status: "new",
    });
    if (lErr) throw lErr;
  });

  afterAll(async () => {
    await admin.from("tenants").delete().eq("slug", GHOST);
  });

  it("authed user reads their own tenant leads", async () => {
    const { data, error } = await user.from("leads").select("id").eq("tenant_slug", "gruve");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("authed user cannot read ghost-tenant leads (RLS filters to empty)", async () => {
    const { data, error } = await user.from("leads").select("id").eq("tenant_slug", GHOST);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("authed user cannot insert into ghost tenant (RLS check clause rejects)", async () => {
    const { error } = await user.from("leads").insert({
      tenant_slug: GHOST,
      name: "Intruder",
      type: "venue",
      status: "new",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501"); // insufficient_privilege (RLS denial)
  });

  it("admin-seeded ghost lead is visible via service role (sanity)", async () => {
    const { data, error } = await admin.from("leads").select("id").eq("tenant_slug", GHOST);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });
});
