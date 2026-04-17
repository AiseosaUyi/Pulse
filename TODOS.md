# TODOS

## Backfill per-service integration tests with RLS

**What:** Vitest is set up (`pnpm test`). `tests/smoke/migrations.test.ts` covers DB-level migration + seed presence for all 6 modules. Still missing: per-service integration tests that exercise the actual service functions (`getLeads`, `createLead`, etc.) under RLS as an authed tenant member.

**Why:** The current smoke test uses the service-role admin client — it confirms the tables exist and are seeded, but doesn't catch RLS leaks, cookie-scoped tenant validation bugs, or service function logic regressions.

**How:** Sign in as the seed user in a test setup, pass the session into the SSR client builder (may need to stub `next/headers` cookies), then call services directly. One integration test per service, happy-path only.

**Context:** Flagged during `/plan-eng-review` of the leads → Supabase migration (2026-04-17). Vitest 4.1.4 landed 2026-04-17.

**Depends on / blocked by:** Designing the cookie/session stub pattern for `createClient()` from `src/lib/supabase/server.ts` under test.

## Tighten RLS on `competitors` table

**What:** Migration `001_intelligence_feed.sql` ships `competitors`, `intel_cards`, `content_briefs` with `for all using (true)` — no tenant gate. Newer modules use `is_tenant_member(tenant_slug)`.

**Why:** Cross-tenant read/write is possible on these three tables. Low impact today (admin client only, no user-facing write surface yet), but a footgun for future features.

**How:** Migration `009` to rename `tenant_id` → `tenant_slug` (or keep `tenant_id` text and re-FK it to `tenants(slug)`), add `is_tenant_member()` policy, drop `using (true)` policy. Update `intel-feed` service if the column name changes.

**Context:** Caught while writing the migration smoke tests (2026-04-17).
