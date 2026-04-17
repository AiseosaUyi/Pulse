# TODOS

## Pick a test runner and add regression coverage

**What:** Add a test runner (likely Vitest — matches the Next 16 / React 19 / Turbopack stack), and backfill a smoke test per Supabase-backed service (`intel-feed`, `leads`, and each subsequent migration).

**Why:** Every module migrated from mock data to Supabase currently ships with zero regression protection. `createLead`, `updateLeadStatus`, `submitCompetitorPost`, etc. all perform validation + DB writes with no way to catch a regression except manual QA. The cost of retrofitting tests compounds with each new module.

**Pros:** Catches validation regressions (type/status/value enum drift), RLS leaks in service functions, and migration-caused runtime breakage. CI can gate PRs.

**Cons:** Setup cost (config, test DB or mocks, first-test friction). Adds ~3-5 min per new service to write happy-path coverage.

**Context:** Flagged during `/plan-eng-review` of the leads → Supabase migration (2026-04-17). Project currently has *no* test runner configured. `intel-feed` also ships without tests. Start with Vitest + one integration test per service hitting the real Supabase dev instance with RLS; evolve to mocked unit tests as shape stabilises.

**Depends on / blocked by:** Nothing. Can land before or after the next module migration.
