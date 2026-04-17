# TODOS

## Extend integration tests to service functions

**What:** `tests/integration/rls.test.ts` covers RLS cross-tenant isolation for leads via a directly-authed supabase-js client (sign-in → ghost tenant → read/write assertions). Still missing: tests that call the actual service functions in `src/lib/services/*.ts` — those go through `createClient()` from `src/lib/supabase/server.ts` which depends on `next/headers` cookies.

**Why:** The RLS test proves the DB is safe. Service-function tests would additionally catch validation-layer regressions (enum drift, type errors, tenant-arg mishandling in the service code itself).

**How:** `vi.mock("next/headers")` with a cookie store pre-loaded with the @supabase/ssr auth cookie (base64 JSON of the session), or refactor `server.ts` to accept an optional cookie-store arg so tests can inject directly.

**Context:** Current RLS test validates the contract end-to-end for one module (leads). Pattern can be extended table-by-table if service-level coverage is desired.

