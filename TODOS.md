# TODOS

## Backfill per-service integration tests with RLS

**What:** Vitest is set up (`pnpm test`). `tests/smoke/migrations.test.ts` covers DB-level migration + seed presence for all 6 modules. Still missing: per-service integration tests that exercise the actual service functions (`getLeads`, `createLead`, etc.) under RLS as an authed tenant member.

**Why:** The current smoke test uses the service-role admin client — it confirms the tables exist and are seeded, but doesn't catch RLS leaks, cookie-scoped tenant validation bugs, or service function logic regressions.

**How:** Sign in as the seed user in a test setup, pass the session into the SSR client builder (may need to stub `next/headers` cookies), then call services directly. One integration test per service, happy-path only.

**Context:** Flagged during `/plan-eng-review` of the leads → Supabase migration (2026-04-17). Vitest 4.1.4 landed 2026-04-17.

**Depends on / blocked by:** Designing the cookie/session stub pattern for `createClient()` from `src/lib/supabase/server.ts` under test.

