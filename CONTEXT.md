# Pulse — Project Context

> Snapshot for a planning agent. Everything below describes the repo as it
> stands at commit `d155f0a` (with the in-progress `outbound-filters` feature
> already merged in working tree).

## 1. Project Overview

Pulse is a multi-tenant marketing operating system for brand/content teams. It
bundles brand audit, competitive intelligence, content generation, SEO,
ads critique, and outbound (prospect discovery + DM drafting) into one
Next.js app with a companion Chrome extension for capturing prospects
while browsing social platforms.

**Users:** internal operators of the first tenant ("Gruve", an events
business in Lagos) plus their team members via tenant invitations. Designed
to support additional tenants but single-tenant usage today.

**Stage:** MVP in production on Vercel, with live traffic. Most modules are
wired to real Supabase tables; the Outbound + Ads Critic + Chrome extension
are the latest slices (versions 6–7). The lead-gen pipeline scoped in §11 is
a new addition, not yet built.

## 2. Repository Structure

```
pulse/
├── .claude/            Claude Code config + plans
├── .cursor/            Cursor AI config
├── .gstack/            GStack (dev tooling) reports
├── .vercel/            Vercel deploy linking
├── docs/               Product/design docs (designs/, roadmap, etc.)
├── extension/          Chrome MV3 extension (outbound capture)
│   ├── icons/
│   └── lib/            Modular JS imported by content.js
├── prompts/            Reference prompt templates (blog/, scoring/)
├── public/             Static assets served by Next
├── scripts/            One-off node scripts (e.g. db seed)
├── src/
│   ├── app/            Next.js 16 App Router
│   │   ├── (app)/      Protected pages (sidebar shell)
│   │   ├── (auth)/     login / signup
│   │   ├── (onboarding)/ 60-second brand audit wizard
│   │   └── api/        Route handlers (cron/*, ext/*, vault/*)
│   ├── components/     UI by domain (briefs, campaigns, coach, leads, ...)
│   │   ├── ui/         shadcn-style primitives (Button, Input, Dialog, ...)
│   │   └── sidebar/
│   ├── lib/
│   │   ├── actions/    "use server" server actions
│   │   ├── ai/         AI call sites (OpenAI via AI SDK v6)
│   │   ├── blog/       Blog editor helpers
│   │   ├── cron/       Cron auth helpers
│   │   ├── data/       Seeds (geo, keywords) and legacy mocks
│   │   ├── integrations/ Third-party wrappers (GA4)
│   │   ├── outbound/   Outbound-specific helpers
│   │   ├── scrape/     Apify + Serper + Cobalt wrappers
│   │   ├── server/     Cached per-request getters
│   │   ├── services/   Read functions over Supabase
│   │   ├── storage/    Supabase Storage helpers
│   │   ├── supabase/   Three clients (server, client, admin)
│   │   ├── types/      TS interfaces
│   │   ├── util/ utils/ validation/
│   └── proxy.ts        Next 16 routing-middleware replacement
├── supabase/
│   ├── cleanups/       One-off tenant-wipe SQL
│   └── migrations/     033 migrations, numbered NNN_*.sql
├── tests/              Vitest unit/integration + Playwright e2e
├── vercel.json         Cron schedule only
├── package.json
├── CLAUDE.md           Repo-root instructions (same content as §3–§9 below)
├── DARK-THEME.md GRUVE-DESIGN.md  Design specs
├── README.md TODOS.md AGENTS.md
└── playwright.config.ts vitest.config.ts next.config.ts
```

## 3. Webapp (Backend + Frontend)

- **Framework:** Next.js **16.2.3** (App Router, Turbopack for both dev and build)
- **Language:** TypeScript 5, React **19.2.4**, React Server Components
- **Styling:** Tailwind v4 (palette in `globals.css` `@theme` block, no `tailwind.config`)
- **Rich text:** Tiptap 3 with markdown extension for the blog editor
- **AI SDK:** `ai` v6 (`generateText` + `Output.object`) via `@ai-sdk/openai` v3
- **Schema validation:** Zod v4

- **Database:** Supabase (Postgres + RLS). No ORM — direct `@supabase/supabase-js`
  and `@supabase/ssr`. Three clients:
  - `src/lib/supabase/server.ts` — SSR client with cookie-bound auth
  - `src/lib/supabase/client.ts` — browser client
  - `src/lib/supabase/admin.ts` — service-role (bypasses RLS) for admin tasks, cron, and ext routes

- **Auth:** Supabase Auth (email/password). Auth gate lives in
  `src/proxy.ts` (Next 16 routing middleware, **not** `middleware.ts`),
  calling `updateSession()` from `src/lib/supabase/middleware.ts`.
  Helpers: `getCurrentUser()`, `requireUser()`, `getUserTenants()`,
  `getCurrentTenant()` in `src/lib/auth.ts`. Tenancy via `memberships`
  table + `tenant=<slug>` cookie.

- **Hosting:** Vercel (push to `main` auto-deploys). Production URL
  `https://pulse-ashy-kappa.vercel.app`. Single Vercel project, Node.js
  runtime (no Edge). Fluid Compute defaults. Crons scheduled in
  `vercel.json`.

- **Background work:** Vercel Cron invokes `/api/cron/*` endpoints
  (bearer-gated via `CRON_SECRET`). Inline fire-and-forget uses
  Next.js `after()` inside route handlers. No dedicated queue/worker
  service — no Inngest, no Trigger.dev, no Upstash QStash.

### Key API endpoints

| Method | Route | Purpose |
|---|---|---|
| GET/POST/OPTIONS | `/api/ext/prospect` | Extension: lookup/upsert a single prospect by (platform, handle) |
| POST/OPTIONS | `/api/ext/prospects/bulk` | Extension: bulk upsert captured prospects (up to 200/batch). Fires qualifier via `after()` on keep/defer rows, overflow marked `qualify_pending` |
| GET/OPTIONS | `/api/ext/outbound-filters` | Extension: fetch tenant's keywords + geo + competitor-URL filter set |
| POST/OPTIONS | `/api/ext/draft-dm` | Extension: generate a personalized DM for a prospect |
| GET/OPTIONS | `/api/ext/primary-template` | Extension: fetch the tenant's primary DM template for a platform |
| POST | `/api/ext/dm/[id]/sent` | Extension: mark a draft DM as sent |
| POST | `/api/cron/scrape-trends` | Daily 06:00 UTC — hashtag/TikTok-CC trend scouts |
| POST | `/api/cron/generate-briefs` | Weekly Sat 23:00 — content brief generation from intel |
| POST | `/api/cron/weekly-digest` | Weekly Sun 07:00 — weekly business review synthesis |
| POST | `/api/cron/discover-prospects` | Daily 02:00 — runs saved `prospect_searches` |
| POST | `/api/cron/qualify-backlog` | New (this pass) — sweeps prospects with `signal_data.qualify_pending: true` |
| GET | `/api/vault/download/[id]` | Authenticated asset download |

### Key frontend pages (App Router groups)

| Group | Route | Purpose |
|---|---|---|
| (auth) | `/login`, `/signup` | Minimal auth shell |
| (onboarding) | `/onboarding/audit` | 60-second brand audit wizard (site scrape → voice + positioning + competitors + briefs) |
| (app) (overview) | `/dashboard`, `/own-analytics`, `/weekly-report` | Home + GA4 pulse + weekly review |
| (app) (content) | `/content-vault` | Saved assets + content multiplier |
| (app) (social) | `/engagement`, `/platform-score`, `/viral-trends`, `/ai-content`, `/post-history` | Social channel tools |
| (app) (growth) | `/leads` | Outbound: pipeline + inbox + discovery + templates |
| (app) (growth) | `/ads-tracker` | Ads Critic (paste-and-score, no data ingestion) |
| (app) (intelligence) | `/intel-feed`, `/competition`, `/content-briefs` (redirect), `/seo-tracker/*` | Competitive + SEO |
| (app) settings | `/settings/profile`, `/team`, `/security`, `/appearance`, `/notifications`, `/brand-voice`, `/brand-positioning`, `/trend-scouts`, `/outbound-filters`, `/integrations`, `/ai-usage`, `/storage` | Tenant config |

## 4. Browser Extension

- **Browser:** Chrome (Chromium-based). Not packaged for Firefox.
- **Manifest:** v3
- **Framework:** Vanilla JS, no bundler, no React. ES modules imported dynamically via `chrome.runtime.getURL`.
- **Version:** 0.5.0 (in manifest), kept in sync with published builds.

**User workflow (today):**

1. User clicks the extension's Options page once, pastes the Pulse base URL and their tenant API token.
2. User browses Instagram / TikTok / X / LinkedIn normally.
3. On a profile page, a floating "Save to Pulse" FAB appears. One click upserts the prospect via `/api/ext/prospect`.
4. On hashtag / post / followers pages on Instagram, a "Capture visible" FAB stages multiple handles into a local bucket (chrome.storage.local). A separate tab (`captured.html`) reviews and bulk-uploads via `/api/ext/prospects/bulk`.
5. **New (this pass):** a passive observer watches real scrolling — post modals, comment-list intersections, tagged-people dialogs — and stages captures with an *intent quote* and a *source type* (post_author / commenter / tagged). Local pre-score uses the tenant's configured filters to auto-discard noise.
6. Options page now exposes a per-device "Disable passive capture" toggle and a deep link to `/settings/outbound-filters`.

**Communication with backend:** REST via `fetch` in the service worker
(content scripts can't bypass CORS in MV3). All calls flow:
content-script → `chrome.runtime.sendMessage` → `background.js apiCall` →
`fetch` with Bearer token → Pulse API. Token + base URL live in
`chrome.storage.sync` under `pulseBaseUrl` / `pulseToken`; capture bucket
+ filter cache live in `chrome.storage.local`.

**Manifest permissions:**

```json
"permissions": ["storage", "clipboardWrite", "activeTab", "tabs"],
"host_permissions": [
  "https://*.vercel.app/*",
  "http://localhost:3000/*"
]
```

Content scripts match `instagram.com`, `tiktok.com`, `twitter.com`, `x.com`, `linkedin.com`. Options UI opens in its own tab.

## 5. Data Model

33 migrations (`001_intelligence_feed.sql` → `033_outbound_templates.sql`).
All tenant-scoped tables FK to `tenants(slug)` and gate via
`public.is_tenant_member(slug)` / `public.tenant_role(slug)` helpers.

### Foundation (migrations 001, 002, 011, 031)

| Table | Key columns | Purpose |
|---|---|---|
| `tenants` | `slug` (PK), `name`, `settings jsonb`, `created_by` | Tenant root. `settings` JSONB holds brand_voice / brand_positioning / scout_config / outbound_filters / platforms etc. |
| `profiles` | `id` (FK auth.users), `username`, `display_name`, `avatar_url` | Per-user metadata |
| `memberships` | `user_id`, `tenant_slug`, `role ∈ (owner,admin,member)` | Tenant access |
| `invitations` | `email`, `tenant_slug`, `role`, `token`, `expires_at` | Onboarding via shareable token |
| `tenant_api_tokens` | `tenant_slug`, `name`, `token_hash`, `token_prefix`, `token_last4`, `scope`, `revoked_at` | Extension/CLI bearer tokens (hashed at rest, raw shown once) |
| `tenant_integrations` | `tenant_slug`, `provider ∈ (ayrshare, wordpress, ghost, resend, ga4)`, `config jsonb`, `secret_token`, `secret_token_2` | Third-party credentials, owner/admin only |

### Outbound (migrations 030, 033) — core to the lead-gen pipeline

| Table | Key columns | Purpose |
|---|---|---|
| `prospect_searches` | `tenant_slug`, `name`, `platform ∈ (instagram,tiktok,twitter,linkedin,manual)`, `signal_type ∈ (keyword,hashtag,event_host,event_attendee,recent_post,manual)`, `query`, `filters jsonb`, `auto_qualify` | Saved discovery queries, cron fodder |
| `prospects` | `tenant_slug`, `platform`, `handle`, `display_name`, `profile_url`, `bio`, `follower_count`, `signal_summary`, `signal_data jsonb`, `qualification_score`, `qualification_reason`, `status` (12-state enum), `notes`, `last_touched_at`, **unique (tenant_slug, platform, handle)** | The people we might DM. Pipeline stages: new → qualifying → qualified/unqualified → drafted → approved → sent → replied → handed_off → closed_won/closed_lost/dismissed |
| `outbound_dms` | `tenant_slug`, `prospect_id`, `version`, `body`, `followup_body`, `status ∈ (drafted,approved,sent,failed,replied,cancelled)`, `generator_model`, `generator_cost_usd` | Drafted DMs, versioned |
| `inbound_messages` | `tenant_slug`, `prospect_id`, `in_reply_to_dm_id`, `platform`, `body`, `received_at`, `read_at` | Replies surfaced as inbox |
| `outbound_templates` | `tenant_slug`, `name`, `platform`, `body`, `is_primary` (partial unique per tenant+platform), `score`, `last_critique jsonb` | Bulk-send templates, AI-critiqued |

**`prospects.signal_data` JSONB** is the flex layer. Today (this pass) it
stores: `source`, `source_type` (post_author/commenter/tagged/opportunistic/manual),
`intent_quote`, `caption_text`, `comment_text`, `captured_from_url`,
`hashtag`, `post_url`, `captured_at`, `session_id`, `passive`, `dom_version`,
`local_qualify: { matchedKeywords, matchedCompetitors, matchedGeo, verdict }`,
`qualify_pending` (flag read by the backlog cron).

### Other major tables

| Table | Purpose |
|---|---|
| `competitors`, `intel_cards`, `content_briefs` | Competitive intelligence (001) |
| `trend_scouts` | TikTok Creative Center + IG hashtag top-posts scouting (013) |
| `own_post_metrics` | First-party social metrics (014) |
| `blog_posts`, `blog_post_versions`, `blog_post_feedback`, `blog_publications` | Blog editor + publish telemetry (015, 025, 026, 028) |
| `weekly_digests` (extended) | Weekly business review narrative + email_sent_at (016, 032) |
| `serp_analyses`, `programmatic_seo_pages`, `keyword_rankings`, `keyword_clusters`, `keyword_groups` | SEO module (007, 017, 018) |
| `scheduled_posts`, `scheduled_post_publications` | Ayrshare cross-post scheduler (019, 028) |
| `saved_content`, `saved_content_files` | Content vault (020, 021) |
| `content_distributions` | Blog → channel-native artifact multiplier (027) |
| `coach_actions` | AI Coach priority actions (029) |
| `ai_call_log` | Every AI call logged here — tenant, feature, model, tokens, cost, duration (seeded in early slices, used by `/settings/ai-usage`) |
| `web_analytics_daily` | GA4 daily per-page metrics (032) |

### What's relevant for the new lead-gen pipeline

- **`prospects` already exists** with the right shape; the new pipeline should
  upsert into it rather than introduce a parallel table.
- **`prospect_searches`** already supports saved queries with `filters jsonb`
  — a natural home for "Jetron organizer page URLs", "Instagram handle
  mentions of @partyverseapp", etc.
- **`tenants.settings.outbound_filters`** (new this pass) holds the tenant's
  keyword / geo / competitor-URL list. Lead-gen can read this and treat
  "competitor URLs" (ticketing platforms) as *positive* signals when found in a
  prospect's bio or linktree.
- **No existing table** for events, organizers, or ticketing-platform pages
  per se — lead-gen will need either a `lead_sources` table (events
  discovered from each ticketing platform) or to funnel everything through
  `signal_data`. The planner should decide.

## 6. External Integrations

| Service | Purpose | Env vars |
|---|---|---|
| **Supabase** | Postgres DB, Auth, Storage | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **OpenAI** | All AI calls (via AI SDK v6). Models: `gpt-4.1` (synthesis), `gpt-4o-mini` (scoring), `gpt-4o` (vision). Router in `src/lib/ai/gateway.ts` | `OPENAI_API_KEY` |
| **Apify** | IG + TikTok hashtag scrapers, Google SERP fallback. See §7 | `APIFY_API_TOKEN`, `APIFY_INSTAGRAM_ACTOR_ID`, `APIFY_TIKTOK_ACTOR_ID`, `APIFY_SERP_ACTOR_ID` |
| **Serper.dev** | Primary Google SERP provider (free 2,500/month). Falls back to Apify. | `SERPER_API_KEY` |
| **Cobalt** | Media download proxy (IG/TikTok asset fetch to Supabase Storage) | `COBALT_API_URL` |
| **GA4 (Google Analytics)** | Per-tenant web metrics via service-account JWT (no SDK; raw JWT in `src/lib/integrations/ga4.ts`) | Service account JSON stored in `tenant_integrations` rows |
| **Ayrshare** | Social post publishing (IG/TT/X/LI/FB) | Secret in `tenant_integrations` (`provider='ayrshare'`) |
| **WordPress REST + Ghost Admin API** | Blog publishing | Secrets in `tenant_integrations` |
| **Resend** | Transactional email (weekly digest delivery) | `tenant_integrations` (`provider='resend'`) |
| **Vercel** | Hosting, cron, env | `CRON_SECRET`, standard `VERCEL_*` vars |

Local dev seeds: `SEED_EMAIL`, `SEED_PASSWORD`, `SEED_*` for `pnpm db:seed`.

## 7. Apify Setup

| Actor | File | Use |
|---|---|---|
| `apify~instagram-scraper` (actor ID env-configured) | `src/lib/scrape/instagram-hashtag.ts` | Top-posts per hashtag for the `scrape-trends` cron. Input: `directUrls: ['.../explore/tags/<tag>/']`, `resultsType: 'posts'`, `resultsLimit`. 180s timeout, 1GB memory. |
| TikTok Creative Center actor (env-configured) | `src/lib/scrape/tiktok-creative-center.ts` | TikTok trending hashtags |
| `apify~google-search-scraper` (env-configured) | `src/lib/scrape/google-serp.ts` | Google SERP fallback when Serper is absent/rate-limited |

**Apify REST wrapper:** `src/lib/scrape/apify-rest.ts` exposes `runActorSync` —
synchronous actor run with timeout + memory controls.

**Proxy configuration:** delegated to the actor. We don't set residential
proxies ourselves — the default Apify datacenter proxy is used. No IP
rotation configuration in the repo today.

**Rate limit / budget awareness:** caps are enforced at the caller
(`limitPerHashtag`, `resultsLimit`). No centralized budget tracker exists.
`ai_call_log` tracks AI spend only, not Apify spend. **Gap for the new
pipeline:** a spend log for Apify actor runs would be valuable.

**Known:** Apify free tier gives $5/mo of compute. Scraping at the volume
scoped in §11 will blow through that immediately — the plan should assume
a paid tier is expected and surface cost estimates.

## 8. Current Lead Workflow

A lead becomes a `prospect` row via four paths today:

1. **Chrome extension manual save** — user clicks "Save to Pulse" on a
   profile. `POST /api/ext/prospect` upserts immediately.
2. **Chrome extension bulk capture** — old "Capture visible" FAB, plus the
   new passive observer, stage handles in chrome.storage.local, then the
   user bulk-uploads via `POST /api/ext/prospects/bulk`. Local pre-score
   (in `extension/lib/detect.js localPreScore`) tags each row with a
   verdict of `keep | defer | discard` using the tenant's
   `outbound_filters`.
3. **Saved discovery searches** — `prospect_searches` rows define keyword /
   hashtag / event-host queries. The `/api/cron/discover-prospects` daily
   cron runs them via `src/lib/services/prospect-searches-runner.ts`
   which calls `src/lib/ai/discover-prospects.ts` (Google site-search via
   Serper/Apify → parse result URLs into IG/TikTok handles) and qualifies
   each insert inline.
4. **Manual creation** — `src/lib/actions/outbound.ts createProspect` server
   action, used by the `/leads` UI.

**Fields captured:** platform, handle, display_name, profile_url, bio,
follower_count, signal_summary (human string), signal_data (JSONB — see §5),
and post-qualifier: qualification_score (0–100), qualification_reason,
status. The AI qualifier uses brand voice + positioning + (new) outbound
filters to score.

**What the partnerships team sees:** the `/leads` page under the `(growth)`
route group. Tabs: **pipeline** (all prospects by status with qualification
score badges), **inbox** (inbound replies), **discovery** (searches +
results), **templates** (saved DM templates with AI-critique scores). No
assignment system, no queue — anyone with tenant access sees everything.

**Scoring / prioritization logic today:**

- Local pre-score (extension, client-side): keyword/competitor/geo string
  match → verdict keep/defer/discard.
- AI qualifier (server): `qualifyProspectAi` in `src/lib/ai/outbound.ts` →
  0–100 score + persona + reason + should_reach_out boolean. Uses brand
  voice + positioning + outbound filters in the system prompt; feeds
  source_type, intent_quote, signal_data in the user prompt. Runs inline
  on single upsert and for single-prospect actions; runs via `after()` on
  bulk upload (top 50 by local-score rank); overflow marked
  `signal_data.qualify_pending: true` and swept by `qualify-backlog` cron.

## 9. Known Issues / Tech Debt

- **Passive capture vs. hashtag grid pages.** The passive observer needs
  `main article` elements to dwell on; Instagram hashtag grids don't have
  those. Captures only fire when the user opens individual posts (modal or
  `/p/<id>/` route). For grid-only browsing, nothing captures.
- **Direct `/p/<id>/` post pages** — current observer triggers on modal
  mount (`isPostModalOpen`); a full-page post route is not handled.
- **`extractVisibleHandles` (legacy manual FAB)** is now deliberately
  strict (requires `@handle` in alt text), which means on modern IG pages
  — where alt text uses display names with no `@` — it captures almost
  nothing. Manual FAB is effectively low-yield.
- **No central Apify spend meter.** We don't know per-tenant actor cost.
- **AI qualifier lacks a recency gate** — can't yet reject dormant accounts
  because we don't capture `last_post_at`.
- **`prospects.signal_data` is unindexed** for the new `source_type` and
  `intent_quote` fields. When we need to filter leads-list by these, a
  migration will be needed (deferred — no UI depends on it yet).
- **Leads "discovery" tab is underbuilt.** The tab type exists but UI is
  minimal; per-search filter overrides are Phase 2.
- **Instagram Stories capture** — not attempted. Ephemeral DOM + highest
  fingerprint risk.
- **Single Vercel cron per endpoint** — no per-tenant sharding, no
  retry-on-failure beyond the default. Long-running searches in a single
  invocation can hit maxDuration.
- **Mock data files** (`src/lib/data/mock-*.ts`) are still imported in a
  few stale spots even though most modules now hit Supabase.
- **Lint** has 16 pre-existing issues (ThemeSwitcher setState-in-effect,
  some unused vars, `vitest.config.ts` uses `require()`). Unrelated to
  outbound or lead-gen.

## 10. Constraints & Non-Goals

- **NOT a scraper-as-a-service.** Pulse is a tenant tool. Scraping exists
  to feed *this* tenant's pipeline, not to resell data.
- **NOT building our own IG/TikTok proxy farm.** We route scraping through
  Apify (or similar) so the ban risk and proxy management live with the
  vendor, not us.
- **NOT automating DM sending on IG/TT.** Human-in-the-loop by design —
  the extension's explicit tagline is "no auto-send, no scraping of DMs,
  no automation IG/TikTok can fingerprint" (`extension/content.js:9`).
  Templates and drafts only; the operator sends manually.
- **Budget:** founder-funded MVP. Soft cap ~$50/month across third-party
  services (OpenAI + Apify + Serper + Resend). Apify free tier ($5) is
  expected to be insufficient for the lead-gen pipeline — the planner
  should assume a paid tier and surface expected monthly spend.
- **Compliance:**
  - Nigerian operators, Nigerian data → NDPR is in scope. No explicit
    consent flow exists today for scraped prospects.
  - Instagram/TikTok ToS — scraping through Apify transfers some legal
    risk to Apify, but not all. The extension being human-in-the-loop is
    a deliberate legal posture.
  - No GDPR-specific machinery yet (no DSR endpoints, no data export).
- **Team:** single primary operator + occasional collaborators. There's no
  "partnerships team" seat today — the first operator (Priye at Gruve) is
  the entire outbound team. Lead-gen output format should assume one
  human reviewing ~100/day, not a multi-person queue.

## 11. The Immediate Goal

> Build a pipeline that discovers Instagram event creators in Nigeria by
> scraping Tier 1–3 ticketing platforms (Jetron, Eventbrite, Luma,
> Tix.africa, Selar, Clooza, Shows.ng, Tt, Tickethub, eGotickets, Tixongo,
> and Instagram mentions of @partyverseapp / @tixtangohq / @partyvestapp),
> enriching with Instagram data via Apify, scoring by event cadence
> (regular / occasional / annual / just-ran-event), cross-platform
> deduping, and outputting ~100 qualified leads/day to the partnerships
> team with reach-out timing recommendations.

## Questions for the Planner

Before writing code, you should nail these down with the human:

1. **Budget ceiling.** The $50/mo soft cap includes existing OpenAI +
   Apify + Serper spend (~$30 already). The pipeline described will blow
   through this. What's the real cap — $50, $200, $500/mo? Ties to Apify
   actor choice (cheap hashtag scraper ~$0.003/post vs. profile scraper
   ~$0.003/profile with enrichment).

2. **Target volume math.** 100 qualified leads/day × (assumed 5% qualify
   rate from raw scrape) = 2,000 candidates scraped/day = ~60,000/mo. At
   Apify's going rate that's $150–$300/mo in scraping alone before
   OpenAI qualifier costs. Confirm this volume is actually needed, or
   whether 30/day is more realistic for MVP.

3. **Tier 1 vs 2 vs 3 platform definitions.** Which platforms are
   Tier 1 (scrape daily), Tier 2 (weekly), Tier 3 (opportunistic)?
   Which have public APIs (Luma, Eventbrite do) vs. need DOM scraping
   (most others)? Start with the API-able ones?

4. **"Event cadence" operationalization.** Over what time window do we
   determine "regular" vs "occasional" vs "annual"? Looking at their
   ticketing page's past-events list? Their IG posting cadence? Both?
   How much history do we scrape — last 12 months? All-time?

5. **"Just-ran-event" detection.** What's the signal — a past-event
   page from last 7 days? A "thank you everyone" caption? Post with
   event-recap hashtag? This is time-sensitive (reach out while they're
   glowing) so worth pinning down.

6. **Organizer dedup key.** The same organizer might list on 3 ticketing
   platforms + have an IG account. What's the canonical key — IG handle?
   WhatsApp number? Email? Business name fuzzy-match? The planner needs
   to define this before schema.

7. **Output destination.** Does the "partnerships team" (§10 notes it's
   really one person today) want:
   (a) entries in `/leads` / `prospects` table (reusing existing UI), or
   (b) a new `/harvests` page showing per-day top 100 with full reasoning, or
   (c) a daily email / Slack push?
   Each has different data-model and UX implications.

8. **Reach-out timing logic.** Is it rule-based ("event within 30 days →
   reach out today", "just-ran-event → 48h later with congrats angle") or
   AI-inferred? If rules, what are they? If AI, what's the prompt shape?

9. **Tenant mapping.** Is this feature scoped to the existing `gruve`
   tenant only, or do we model it as generic (so another Nigerian events
   brand could use it later)? Affects whether platform URLs live in
   `tenants.settings.outbound_filters.competitor_urls` (already there) or
   a new `platform_sources` table.

10. **Apify actor strategy.** For IG enrichment we need bios + recent
    captions + follower counts. Which actor — `apify/instagram-scraper`
    (already configured, broad) or `apify/instagram-profile-scraper`
    (more targeted, cheaper per handle)? And for ticketing-platform
    scraping, are there existing actors we should use or do we write a
    generic "render URL, extract JSON-LD + structured data" actor?

11. **Handling platform bans / ToS escalation.** If Instagram starts
    throttling Apify heavily, do we have a fallback strategy (alternative
    providers like ScraperAPI, Zyte)? Or do we accept reduced volume?

12. **Consent / NDPR surface.** Do we need to (a) surface a privacy
    notice, (b) honor delete requests, (c) exclude certain categories
    (e.g. non-business accounts)? This is handwavy in the codebase today
    and the lead-gen pipeline is the biggest data surface yet.

13. **Durable execution.** The pipeline has 3+ stages (discover → enrich
    → score → dedup → output) per source. A failure mid-way shouldn't
    retry from scratch. Is Vercel Workflow DevKit (`workflow` package)
    acceptable for orchestration, or do we stay on simple cron + inline
    `after()`? Workflow gives durable retries and checkpointing but adds
    a dependency.

14. **Where does Instagram come in?** The goal describes scraping
    ticketing platforms *and* IG mentions of 3 handles. The IG-mentions
    bit implies we poll those 3 accounts' tags + comments. Which Apify
    actor + cadence? Is this a separate source tier from ticketing
    platforms?

15. **Overlap with existing `prospect_searches`.** Should each ticketing
    platform be a row in `prospect_searches` with a new
    `signal_type = 'ticketing_platform'`? Or is it parallel machinery?
    Favoring reuse keeps the existing qualifier + pipeline UI working
    for free.
