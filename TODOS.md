# TODOS

## Feature 1: Own-content analytics (CSV + screenshot intake)

**What:** Import own-post metrics for Gruve/Sippy across IG, TikTok, Twitter, LinkedIn via CSV export (Meta/TikTok/LinkedIn Business Suites) and screenshot + Claude vision (Twitter — no export since 2023). New `own_post_metrics` table, new `/own-analytics` page, uploads into `intel-screenshots` Supabase Storage bucket.

**Why:** PULSE currently infers "social reach" from `posts.reach`, which is seeded once. Live ingestion of weekly metrics per post gives Abas a true current-state dashboard for Gruve/Sippy's own performance — not just competitors'.

**How:** See the draft architecture deferred from the 2026-04-17 intelligence-expansion plan. Parent file: `docs/plan-intelligence-expansion.md` (original v1, now reduced to F2 only). Estimated 14 files, 1 migration, 1 Storage bucket.

**Context:** Deferred from the April 17 plan-eng-review when scope was split to ship F2 (brief generator) first. F1 is the next plan in sequence.

**Depends on / blocked by:** F2 landing. Reuses the AI Gateway wrapper from F2.

## Feature 3: Viral spotting (cross-brand + TikTok Creative Center + hashtag scout)

**What:** Surface `cross_brand` patterns (already exists but not in UI), scrape TikTok Creative Center trending page weekly, and accept manual hashtag-scout screenshots. New `trend_scouts` table, rebuild `/viral-trends` page off real data, one new Vercel Cron.

**Why:** Once F2 turns competitor cards into briefs, the next ceiling is "what's going viral in our niche that our tracked competitors haven't touched yet." Viral spotting feeds the brief generator with broader signal.

**How:** See the draft architecture deferred from the 2026-04-17 intelligence-expansion plan. Scrape TikTok Creative Center public page (ToS grey, Apify fallback ~$1/mo). Estimated 12 files, 1 migration, 1 cron.

**Context:** Deferred from April 17 plan-eng-review. Must land AFTER F2 validates the brief generator — otherwise viral ideas have nowhere useful to go.

**Depends on / blocked by:** F2 landing AND F2 brief-generator quality validated (Priye ratings ≥ 3/5 over 10 briefs). Reuses the AI Gateway wrapper from F2.

## Per-tenant AI cost dashboard

**What:** A simple `/settings/ai-costs` page showing the tenant's AI call volume, token counts, cache hit rate, and cost-to-date. Reads from `ai_call_log` (RLS already enabled for tenant reads per migration 012).

**Why:** Transparency into AI spend as usage grows. Also exposes prompt-cache hit rate, which is the primary lever for cost control.

**How:** Single Server Component page, one aggregated query. No new schema, no new auth wiring — RLS is already in place.

**Context:** `ai_call_log` was created with tenant-read RLS specifically to enable this later without a second migration. Low lift. Waiting on justified demand (i.e., the team actually wonders about cost).

**Depends on / blocked by:** F2 landing so there's data to show.

## Brand voice inference from existing posts

**What:** One-shot LLM feature that reads the tenant's last 20 published posts (from `posts` table) and auto-populates the `brand_voice` editor with tone, audience, do/don't list, and example posts. User reviews + approves before saving.

**Why:** Writing a brand voice doc from scratch takes ~30 minutes per tenant. AI inference from real published content grounds the voice in what the brand actually does, not what the founder thinks it does.

**How:** New action `inferBrandVoice(tenantSlug)` → gpt-4o or Claude Sonnet reads 20 posts → returns zod-validated `BrandVoice` shape → editor loads it pre-filled. Cost: ~$0.03 one-time per tenant.

**Context:** Flagged during 2026-04-17 plan-eng-review. Ambitious quality-of-life feature. Not a v1 blocker — manual brand voice is the baseline.

**Depends on / blocked by:** F2 landing with manual brand voice editor. Tenant needs ≥10 real posts in `posts` table for inference quality.

## Weekly email digest of briefs (Resend)

**What:** Sunday 08:00 UTC email to each tenant member summarizing the week's generated briefs with links into `/content-briefs`. Resend free tier (3K emails/mo) covers this forever at current scale.

**Why:** Abas doesn't live in PULSE. A Sunday-morning email is a push notification into his existing inbox workflow — zero friction to see "here's what the team should post this week."

**How:** Extend `/api/cron/generate-briefs` to also send emails after insert (or new cron `/api/cron/weekly-digest` at 08:00 Sunday). Resend SDK already implied by existing `docs/API-PRICING-GUIDE.md` — free tier, simple to add.

**Context:** Flagged during 2026-04-17 plan-eng-review. Distribution channel, not a feature. Ship F2 in-app UX first, validate briefs are useful, then add email.

**Depends on / blocked by:** F2 landing + brief-generator quality validated.

## Harden Vercel Cron auth beyond CRON_SECRET

**What:** Replace the shared-secret `Authorization: Bearer ${CRON_SECRET}` check in `/api/cron/*` routes with Vercel's signed-request verification via `x-vercel-signature` header and public-key check.

**Why:** Long-lived shared secret is a weak link if the env var ever leaks (e.g., accidental commit, bad CI). Signed requests eliminate the replay/leak risk.

**How:** Vercel Cron signs requests; verification is a short ES256 public-key check in the route handler.

**Context:** Flagged during 2026-04-17 plan-eng-review. Post-MVP hardening, not a v1 blocker. One cron job currently, so impact is bounded.

**Depends on / blocked by:** Nothing.

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

