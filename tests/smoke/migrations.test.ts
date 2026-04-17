import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

// DB-level smoke tests: verify migrations applied + seed is present.
// Uses service role (bypasses RLS). RLS-aware tests to follow.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TENANTS = ["gruve", "sippy"] as const;

describe("migrations + seed smoke", () => {
  for (const slug of TENANTS) {
    it(`${slug}: tenant row exists`, async () => {
      const { data, error } = await admin.from("tenants").select("slug").eq("slug", slug).single();
      expect(error).toBeNull();
      expect(data?.slug).toBe(slug);
    });
  }

  const TABLES = [
    { name: "leads", tenantCol: "tenant_slug" },
    { name: "posts", tenantCol: "tenant_slug" },
    { name: "campaigns", tenantCol: "tenant_slug" },
    { name: "keyword_rankings", tenantCol: "tenant_slug" },
    { name: "engagement_items", tenantCol: "tenant_slug" },
    { name: "competitors", tenantCol: "tenant_id" },
  ] as const;

  for (const { name, tenantCol } of TABLES) {
    for (const slug of TENANTS) {
      it(`${name}: ${slug} has ≥1 seeded row`, async () => {
        const { data, error, count } = await admin
          .from(name)
          .select("id", { count: "exact", head: false })
          .eq(tenantCol, slug)
          .limit(1);
        expect(error).toBeNull();
        expect(count ?? 0).toBeGreaterThanOrEqual(1);
        expect(data).toBeDefined();
      });
    }
  }

  // Migration 012 additions: presence + schema, not row counts (expected empty).
  it("content_briefs has generator metadata columns", async () => {
    const { error } = await admin
      .from("content_briefs")
      .select("id, triggered_by_type, pattern_hash, generator_model, generator_cost_usd, dismissed_at, dismissed_reason")
      .limit(1);
    expect(error).toBeNull();
  });

  it("ai_call_log table exists with expected columns", async () => {
    const { error } = await admin
      .from("ai_call_log")
      .select("id, tenant_slug, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, success, error_message")
      .limit(1);
    expect(error).toBeNull();
  });

  it("tenants.settings is jsonb and readable", async () => {
    const { data, error } = await admin
      .from("tenants")
      .select("slug, settings")
      .limit(2);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("trend_scouts table exists with expected columns", async () => {
    const { error } = await admin
      .from("trend_scouts")
      .select("id, tenant_slug, platform, source, hashtag, summary, metrics, ai_analysis, applicability, dismissed_at, captured_at")
      .limit(1);
    expect(error).toBeNull();
  });
});
