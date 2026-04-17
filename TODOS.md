# PULSE — Build Roadmap

Organized by phase. Each item has a scope estimate in CC+gstack time and dependencies.
Check items off as they ship. Phases are **not rigid** — pull forward if a later
item unblocks something earlier.

---

## P0 — Operational / Security (do ASAP)

- [ ] **Rotate Supabase DB password** — pasted in chat earlier. Supabase → Project Settings → Database → Reset password. (~2 min)
- [ ] **Revoke leaked AI Gateway API key** — `vck_7UDS...` was pasted in chat. Since we've migrated to OpenAI direct, the Gateway env var is already removed from Vercel. Just revoke the key at Vercel dashboard → AI Gateway → API Keys to be safe. (~1 min)
- [ ] **Add `OPENAI_API_KEY` to Vercel env** — `vercel env add OPENAI_API_KEY production` (paste interactively, then repeat for preview + development, then `vercel env pull .env.local`). (~3 min)
- [ ] **Restore SEED_* vars in `.env.local`** — got wiped by `vercel env pull`. Append `SEED_EMAIL`, `SEED_PASSWORD`, `SEED_USERNAME`, `SEED_DISPLAY_NAME`. (~1 min)

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

- [ ] **Playwright E2E setup** — committed to in eng review. `playwright.config.ts`, `tests/e2e/`, CI wiring. First test: login → `/content-briefs` → see brief. (~1 day)
- [ ] **Cron integration test** — mocked AI Gateway, assert route handler auth + idempotency + empty-state behavior. (~2 hrs)
- [ ] **Per-service integration tests** — cookie-stubbed `next/headers` mock to call service functions under test. Covers `getLeads`, `createLead`, etc. (~4 hrs — non-trivial mock pattern)
- [ ] **Eval suite for brief generator** — 5-10 seed briefs + quality rubric. Baseline for prompt-change regression detection. (~3 hrs, depends on first week of real-use data)
- [ ] **Harden Vercel Cron auth** — replace `CRON_SECRET` shared secret with Vercel's signed-request verification via `x-vercel-signature`. (~1 hr)

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

## Suggested build order

1. **Today/tomorrow:** finish P0 (security hygiene) + P1 polish (close F2 loop cleanly)
2. **This week:** P2 quick wins (AI cost dashboard + color cleanup). Demonstrates F2 ROI, tidies up visual drift.
3. **Next week:** P3 F3 (viral spotting) — biggest net-new capability, the "knows what's trending" leap.
4. **Parallel to P3:** P6 Playwright E2E and cron test (testing debt from F2).
5. **After F3 validates:** P3 F1 (own analytics) — large feature but lower urgency.
6. **Alongside F1:** P4 mock hydration (picks off routes one by one).
7. **After F1:** P5 insight engine — enables weekly digest + dashboard suggestions.
8. **Ongoing:** P7 platform/ops items. Custom domain, analytics, Resend — pull in when ready.
