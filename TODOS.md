# TODOS

## Design the insight/rules engine powering weekly digest + suggestions

**What:** `getWeeklyDigest()` returns `null` and `getSuggestions()` returns `[]`. The UI already handles the empty states gracefully. These two functions need a rules engine (or LLM call) that synthesizes structured strategic recommendations from the underlying data.

**Why:** Without this, the Intelligence Feed sidebar shows "Not enough data for a digest yet" and the dashboard suggestions list is blank — correct but unhelpful.

**How:** Decide between (a) deterministic rules over `intel_cards` + `leads` + `posts` metrics, (b) LLM summarization via AI Gateway, or (c) hybrid. Rules engine output needs to fit `WeeklyDigest` (topCompetitorMoves, winningFormats, recommendedActions, strategicBrief) and `Suggestion[]` types.

**Context:** All source data is now in Supabase after the 2026-04-17 migration batch, so the engine has a coherent input to read from.

## Extend integration tests to service functions

**What:** `tests/integration/rls.test.ts` covers RLS cross-tenant isolation for leads via a directly-authed supabase-js client (sign-in → ghost tenant → read/write assertions). Still missing: tests that call the actual service functions in `src/lib/services/*.ts` — those go through `createClient()` from `src/lib/supabase/server.ts` which depends on `next/headers` cookies.

**Why:** The RLS test proves the DB is safe. Service-function tests would additionally catch validation-layer regressions (enum drift, type errors, tenant-arg mishandling in the service code itself).

**How:** `vi.mock("next/headers")` with a cookie store pre-loaded with the @supabase/ssr auth cookie (base64 JSON of the session), or refactor `server.ts` to accept an optional cookie-store arg so tests can inject directly.

**Context:** Current RLS test validates the contract end-to-end for one module (leads). Pattern can be extended table-by-table if service-level coverage is desired.

