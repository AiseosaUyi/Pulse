# PULSE — Build Roadmap

Organized by phase. Each item has a scope estimate in CC+gstack time and dependencies.
Check items off as they ship. Phases are **not rigid** — pull forward if a later
item unblocks something earlier.

---

## P0 — Operational / Security (do ASAP)

- [ ] **Rotate Supabase DB password** — pasted in chat earlier. Supabase → Project Settings → Database → Reset password. (~2 min)
- [ ] **Revoke leaked AI Gateway API key** — `vck_7UDS...` was pasted in chat. Since we've migrated to OpenAI direct, the Gateway env var is already removed from Vercel. Just revoke the key at Vercel dashboard → AI Gateway → API Keys to be safe. (~1 min)
- [ ] **Add `OPENAI_API_KEY` to Vercel env** — `vercel env add OPENAI_API_KEY production` (paste interactively, then repeat for preview + development, then `vercel env pull .env.local`). (~3 min)
- [ ] **Restore SEED_* vars in `.env.local`** — got wiped by `vercel env pull`. Append `SEED_EMAIL`, `SEED_PASSWORD`, `SEED_USERNAME`, `SEED_DISPLAY_NAME`. (~1 min). This is also why `tests/integration/rls.test.ts` fails locally right now (`signInAsSeedUser` → "missing email or phone") — fixing this SEED_* gap fixes that test too.
- [ ] **Seed (or stop asserting on) `gruve` leads/posts/campaigns rows** — `tests/smoke/migrations.test.ts` asserts `gruve` has ≥1 row in `leads`, `posts`, and `campaigns`; all three currently return 0 in this environment. Either re-run `pnpm db:seed` for `gruve`, or if those tables are intentionally unseeded now, update the smoke test's assumption. Noticed while shipping the `/api/v1` + MCP server branch (2026-07-10) — pre-existing, unrelated to that work.
- [ ] **Stop leaking raw Postgres error messages on `/api/v1` 500s** — every route's generic error path returns `error.message` straight from Supabase (`apiError(500, error.message, ...)`), which can expose column/constraint names to an authenticated caller. Replace with a generic "Internal error" response and log the real error server-side only. Flagged during the `/api/v1` + MCP pre-landing review (2026-07-10) — consistent pattern across ~20 routes, deliberately not fixed in that PR to avoid a sweeping last-minute rewrite.
- [ ] **Check for legacy `cli`/`automation`/`other`-scoped API tokens in production** — migration 088 only auto-upgraded `scope='extension'` tokens to full `/api/v1` access; tokens minted with the other 3 legacy scope values fail closed (403) on every scoped `/api/v1` route. Confirm how many such tokens exist (`select count(*) from tenant_api_tokens where scope in ('cli','automation','other')`) and re-mint or migrate them if any are in active use. Flagged during the `/api/v1` + MCP adversarial review (2026-07-10) — not urgent (fails safe, no data exposure).
- [ ] **No retry path for an already-due post whose approval-time QStash enqueue fails** — `src/lib/services/approvals.ts`'s `applyToScheduledPost()` catches QStash errors non-fatally so an approval decision never rolls back on a delivery hiccup, but the `schedule-flush` cron's backstop query (`gte("scheduled_for", now)`) excludes posts whose `scheduled_for` is already in the past, so a same-day approval that fails to enqueue has no automatic retry — it'll just sit `status='scheduled'` with `qstash_message_id=null` until someone notices via `/publish-queue`. Either widen schedule-flush's window to also catch recently-overdue `scheduled` rows with no `qstash_message_id`, or add a short grace window. Flagged while building Part 3 (notifications + mobile approvals), 2026-07-10 — not urgent (QStash outages are rare, `/publish-queue` already surfaces stuck rows for manual publishing).

---

## P1 — F2 Polish (close the loop on what just shipped)

- [ ] **Overwrite placeholder brand voice** — I wrote a placeholder for Gruve during smoke testing. Visit `/settings/brand-voice` → overwrite with the real Gruve voice, then do Sippy too. Run an on-demand "Steal This" to verify output quality with the real voice. (~30 min manual per tenant)
- [x] **Add `Badge` variants `approved` + `dismissed`** — proper named variants.
- [x] **Dismiss undo** — 5s optimistic-delay pattern in BriefCard. No toast library needed; dismiss is scheduled 5s out and only commits if user doesn't undo.
- [x] **Status filter on `/content-briefs`** — pill filter bar (All / Drafts / Approved / Published).
- [x] **"Show dismissed" toggle on `/content-briefs`** — checkbox surfaces when any dismissed briefs exist for the tenant.
- [x] **`/settings/brand-voice` sidebar nav item** — added under Intel feed group.

---

## P2 — Quick Wins (validates F2 investment)

- [x] **AI cost dashboard at `/settings/ai-usage`** — per-tenant month-to-date AI spend, call count, token totals, cache hit rate, per-model breakdown, recent-calls table. Entry point added to `/settings` page.
- [x] **Purple→maroon cleanup on 5 main pages** — `/ai-content`, `/weekly-report`, `/viral-trends`, `/platform-score`, `/seo-tracker/topical-map`.
- [x] **Purple→maroon cleanup on remaining surfaces (15 files, 52 occurrences)** — `accent-purple`/`accent-pink`/`gradient-purple-pink`/`text-purple-300` swept from `MorningBriefing`, `CrossBrandInsights`, `WeeklyDigest`, `IntelCard`, `NotificationBell`, `PulseSuggestions`, `PlatformBreakdown`, `SEOTabNav`, `KeywordSeedInput`, `AddPostModal`, `content-vault/{page,content-extractor}`, `intel-feed/client`, `error.tsx`, `not-found.tsx`. Gradients collapsed to flat `bg-primary-500`. `Logo.tsx` dark gradient kept per DARK-THEME.md spec. `globals.css` alias tokens retained as back-compat safety net.

---

## P3 — Features (priority order: F3 → F1)

### F3 — Viral spotting

- [x] **Migration 013: `trend_scouts` table** — tenant-scoped, RLS-gated.
- [x] **Cross-brand pattern UI on `/viral-trends`** — patterns from `cross-brand.ts` now surfaced at top of viral-trends page.
- [x] **Manual trend intake form** — AddTrendModal: platform + hashtag + URL + summary + metrics. AI analyzes on submit.
- [x] **Trend analysis AI call** — `src/lib/ai/analyze-trend.ts` via GPT-5, logs to `ai_call_log`.
- [x] **Cron job `scrape-trends`** — Sat 22:00 UTC in `vercel.json`, wired to GPT-5 analysis pipeline.
- [x] **Extend smoke + RLS tests for trend_scouts** — cross-tenant RLS denial test + schema presence test.
- [x] **Apify wiring for TikTok + Instagram** — Clockworks TikTok + apify/instagram-scraper actors, called via minimal REST wrapper in `src/lib/scrape/apify-rest.ts` (SDK had pnpm isolation issues on Vercel; plain fetch sidesteps them).

### F1 — Own-content analytics

- [x] **Migration 014: `own_post_metrics` table** — tenant-scoped + RLS-gated.
- [x] **CSV parser** — per-platform header maps for Meta/TikTok/LinkedIn Business Suite exports; tolerates unknown headers.
- [x] **Screenshot vision extractor** — GPT-4o extracts metrics from any platform's analytics screenshot. ~$0.01/upload.
- [x] **`/own-analytics` page** — stat cards + per-platform breakdown + upload panel (CSV + screenshot) + recent imports table.
- [x] **Sidebar nav** — "Own analytics" under OVERVIEW group.
- [x] **Extend smoke + RLS tests** — cross-tenant RLS denial test + table schema presence test.
- [x] **Extend `/dashboard` socialReach to aggregate real data** — swapped from seeded `posts.reach` to live `own_post_metrics`. Shows "Import metrics on /own-analytics" when empty. Falls back through reach → views → impressions.

---

## P4 — Hydrate remaining mock pages (DONE)

- [x] **`/ai-content` — switched off mocks** — Calendar reads from new `scheduled_posts` table (migration 019). Suggestions come from real `content_briefs` (approved + draft). Added `ScheduleModal` with date/time picker + caption override, server actions for scheduling/status/delete. Empty state routes user back to `/intel-feed`.
- [x] **`/content-vault` — switched off mocks** — New `saved_content` table (migration 020) tracks saved links, intel cards, trend scouts. Content extractor now actually saves via `saveContentFromUrl` (detects platform from URL, picks emoji). Trends panel reads from real `trend_scouts`. One-click "Save" converts a trend into a vault item. Filter tabs (All/New/Scheduled/Used), status-cycling badges, per-row delete.
- [x] **`/platform-score` — derived from real data** — Composite score from tenant platform config (connection + followers) + posts (30-day frequency, engagement rate). Trend from prior window. Shows "no data" state with nav to Settings/Own analytics when empty.
- [x] **`/weekly-report` — shipped via P5 insight engine** — reads `weekly_digests` regenerate on demand.
- [x] **`NotificationBell` — switched off mocks** — derives from engagement_items (unread), intel_cards (high-impact last 3 days), content_briefs (approved), leads (cold 14+ days), keyword_rankings (new top-10). No table, computed per request.
- [x] **`src/lib/services/seo.ts` — cleaned up** — dropped dead `getProgrammaticTemplates`/`getSERPAnalyses` (real services exist). `/seo-tracker` dashboard now reads real `blog_posts` via `listBlogPosts`.

---

## P5 — Insight Engine (DONE)

- [x] **Engine design** — hybrid: deterministic rules aggregate structured signals from 6 tables, GPT-4.1 writes the strategic narrative + prioritized actions. Stored in `weekly_digests` (migration 016).
- [x] **Weekly digest synthesis** — reads intel_cards, trend_scouts, own_post_metrics, keyword_rankings, leads → strategic brief + 3-5 priority actions. Cost ~$0.01/tenant/week.
- [x] **Dashboard suggestions** — getSuggestions reads latest digest's recommended_actions. Refreshes with each digest regeneration.
- [x] **Sunday cron `/api/cron/weekly-digest`** — 07:00 UTC, iterates tenants, idempotent per (tenant, week_of).
- [x] **`/weekly-report` rebuilt** — strategic brief, priority actions with target-module links, performance stat trio, top competitor moves, winning formats. "Regenerate" button for on-demand.

---

## P6 — Testing + Infra Hardening

- [x] **Playwright E2E scaffolded** — `playwright.config.ts`, `tests/e2e/auth-gate.spec.ts` covering unauthed /dashboard redirect + ?next preservation + login/signup render. `pnpm test:e2e` script wired. User needs to run `pnpm exec playwright install chromium` once locally before first run. CI wiring deferred.
- [x] **Cron integration + unit tests** — `tests/unit/cron-auth.test.ts` (7 tests: missing secret, bad bearer, env case-insensitivity, dev vs prod Vercel-header requirement) + `tests/integration/cron-routes.test.ts` (9 tests across 3 cron routes: missing auth / wrong bearer / missing Vercel marker). Total: 62 vitest tests green (was 46).
- [x] **Harden Vercel Cron auth** — shared `verifyCronRequest()` in `src/lib/cron/auth.ts`. Requires `Bearer $CRON_SECRET` AND `x-vercel-cron` header in production. Prevents a leaked secret from letting anyone hit the endpoints via curl. All three cron routes (scrape-trends, generate-briefs, weekly-digest) wired through the shared verifier. Falls back to bearer-only in dev/test.
- [ ] **Per-service integration tests** — cookie-stubbed `next/headers` mock to call service functions under test. Covers `getLeads`, `createLead`, etc. (~4 hrs — non-trivial mock pattern — deferred)
- [ ] **Eval suite for brief generator** — 5-10 seed briefs + quality rubric. Baseline for prompt-change regression detection. (~3 hrs, depends on first week of real-use data — deferred)

---

## P7 — Platform / Ops

- [ ] **Custom domain `pulse.gruve.events`** — DNS + Vercel domain config. (~30 min config + DNS propagation)
- [ ] **`@vercel/analytics` + `@vercel/speed-insights`** — install + wire into root layout. Zero-config Core Web Vitals. (~15 min)
- [ ] **Error monitoring** — Sentry or Vercel's built-in. Captures server-action failures, AI Gateway timeouts. (~1 hr)
- [ ] **Resend wiring for email digests** — Sunday morning email summarizing week's briefs. (~2 hrs, depends on P5)
- [ ] **Brand voice inference from existing posts** — Claude reads last 20 published posts, auto-fills `brand_voice` shape. One-click onboarding. (~2 hrs, optional polish)

---

## Total effort estimate

| Phase | CC+gstack time | Human team equivalent |
|---|---|---|
| P0 — Ops/security | ~10 min | N/A (user action) |
| P1 — F2 polish | ~2-3 hrs | ~1 week |
| P2 — Quick wins | ~4-5 hrs | ~1.5 weeks |
| P3 — F3 viral spotting | ~10 hrs | ~2 weeks |
| P3 — F1 own analytics | ~10 hrs | ~2 weeks |
| P4 — Mock hydration | ~12 hrs | ~2.5 weeks |
| P5 — Insight engine | ~8 hrs | ~1.5 weeks |
| P6 — Testing/infra | ~15 hrs | ~2 weeks |
| P7 — Platform/ops | ~5 hrs | ~1 week |
| **Total** | **~70 hrs** | **~14 weeks human** |

All figures assume CC+gstack pace. Real calendar time for the founder is gated by decision-making speed, not code speed.

---

## P8 — Content Pipeline (post-MVP follow-ups)

Captured during /plan-eng-review on 2026-05-08. Plan file: `~/.gstack/projects/Pulse/aiseosauyi-idahor-main-content-pipeline-plan-20260508-112310.md`.

### Calendar/Plan view + bulk-edit polish
- **What:** Drag-drop weekly calendar grid for `content_items.scheduled_at`; bulk-edit dialog (multi-select rows → apply status/assignee/platforms); smart filename→title heuristic surfacing; mobile-friendly upload affordances.
- **Why:** Table + grid covers the visibility ask, but ops teams plan in calendar shape. Bulk-edit is the second-most-requested action after upload.
- **Pros:** Major UX upgrade; addresses the "30 files at once" pain point that bulk-apply in stepper only half-solves.
- **Cons:** ~3 days of work; calendar libs are heavy; drag-drop has its own QA surface.
- **Context:** Defer to v1.1 once Pipeline shape is validated in production. Calendar can use `react-day-picker` + custom drop-zones per day. Bulk-edit uses the existing Dialog primitive.
- **Depends on:** Pipeline MVP shipped + 2 weeks of usage data so we know what teams actually do.

### Auto-generate scheduled_posts rows on status=scheduled
- **What:** When a `content_item` flips to `status='scheduled'`, generate one `scheduled_posts` row per selected platform that references a new `content_item_id` column.
- **Why:** Bridges Content Pipeline (asset-shaped) to existing posting machinery (post-shaped). Sets up the path for actual publishing without changing Pipeline UX.
- **Pros:** Reuses existing posting infra; makes Pipeline status="Posted" stop being purely manual once posting is wired up.
- **Cons:** Requires a `content_item_id` column on `scheduled_posts`; needs reverse-lookup so editing the asset cascades to linked scheduled_posts; conflict resolution if user edits the platform list after scheduling.
- **Context:** Migration: add `scheduled_posts.content_item_id uuid references content_items(id) on delete set null`. Trigger or service-layer fanout in `actions/content-pipeline.ts:updateContentItem`.
- **Depends on:** Pipeline MVP shipped.

### Google OAuth verification submission
- **What:** Submit Pulse's Google OAuth app for verification with Drive scopes. While in "Testing" mode, capped at 100 users.
- **Why:** Required before broad launch. Without verification, every new user past 100 hits a Google block.
- **Pros:** Unblocks scale.
- **Cons:** 4-6 weeks of Google review; requires privacy policy URL, demo video of the OAuth flow, security questionnaire. Drive scopes are "sensitive" so the reviewer typically requests a homepage screencast.
- **Context:** Operational, not engineering. Owner: founder. Trigger: when active user count crosses 75 (warning sign), submit. Track at https://console.cloud.google.com/apis/credentials/consent.
- **Depends on:** Pipeline MVP shipped + privacy policy at `/legal/privacy` exists.

---

## P9 — Individual Persona Content Calendar (post-office-hours follow-ups)

Captured during /office-hours + /plan-eng-review on 2026-07-08. Design doc: `~/.gstack/projects/Pulse/aiseosauyi-idahor-main-design-20260708-164316.md`.

### Generalize the content calendar beyond the founder's own tenant
- **What:** Open the individual-persona content calendar (topic queue + daily briefing engine) to other individual-persona signups, not just the founder's own tenant.
- **Why:** V1 is tenant-allowlist-gated to validate the mechanism first. If it works for the founder, it's a real product-line expansion for the "individual" persona, which currently has almost no dedicated features.
- **Pros:** Unlocks individual-persona monetization; the daily-briefing mechanism is the actual moat, already built.
- **Cons:** Needs the manual interest-tag settings field to become self-serve UX; needs UI polish beyond founder-dogfood quality; building this before validation risks exactly the premature-scope problem this whole design process was built to avoid.
- **Context:** Gate lives at the tenant-allowlist check (same pattern as `isEventScraperEnabledForTenant`) — removing/expanding it is the actual unlock, not a rebuild.
- **Depends on:** V1 shipped + a few weeks of the founder's own real usage confirming the mechanism actually works.

### Close the loop from post performance back into topic selection
- **What:** Correlate posted slots against `own_post_metrics` (likes/comments/shares/saves) to learn which topics/angles actually perform, feeding that signal back into future topic selection.
- **Why:** The feature's whole pitch is AI-driven quality, but v1 has no feedback loop — it can't tell a topic that flopped from one that landed. `own_post_metrics` already exists and is populated by the existing metrics-sync cron.
- **Pros:** Cheap to add once there's data (the metrics table and sync cron already exist); turns the feature from "AI guesses" into "AI learns."
- **Cons:** Needs real posted-slot history to correlate against — no signal exists until the founder has actually posted for a few weeks.
- **Context:** Surfaced by the outside-voice cross-model review during `/plan-eng-review` (2026-07-08) — not part of the original design doc.
- **Depends on:** V1 shipped + real posting history to correlate.

---

## Suggested build order

1. **Today/tomorrow:** finish P0 (security hygiene) + P1 polish (close F2 loop cleanly)
2. **This week:** P2 quick wins (AI cost dashboard + color cleanup). Demonstrates F2 ROI, tidies up visual drift.
3. **Next week:** P3 F3 (viral spotting) — biggest net-new capability, the "knows what's trending" leap.
4. **Parallel to P3:** P6 Playwright E2E and cron test (testing debt from F2).
5. **After F3 validates:** P3 F1 (own analytics) — large feature but lower urgency.
6. **Alongside F1:** P4 mock hydration (picks off routes one by one).
7. **After F1:** P5 insight engine — enables weekly digest + dashboard suggestions.
8. **Ongoing:** P7 platform/ops items. Custom domain, analytics, Resend — pull in when ready.
