# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (localhost:3000, Turbopack)
pnpm build        # Production build (also runs the TypeScript check)
pnpm lint         # ESLint
pnpm test         # Vitest unit tests (one-off)
pnpm test:watch   # Vitest watch
pnpm test:e2e     # Playwright end-to-end
pnpm test:e2e:ui  # Playwright with UI
pnpm db:seed      # One-time founder + Gruve/Sippy seed (reads SEED_* + SUPABASE_* from .env.local)
pnpm verify:gruve       # scripts/verify-gruve-contract.ts — checks the Gruve API contract hasn't drifted
pnpm smoke:publish      # scripts/publish-smoke.ts — end-to-end publish smoke test (runs under react-server condition)
pnpm check:contentful   # scripts/check-contentful-model.ts — validates the target Contentful space's content model before publishing
pnpm smoke:cleanup      # scripts/smoke-cleanup.ts — tears down data left behind by smoke tests
```

Single test: `pnpm test tests/unit/foo.test.ts`. Tests live under `tests/unit`, `tests/integration`, `tests/smoke`, `tests/e2e`. Playwright config at `playwright.config.ts`, Vitest at `vitest.config.ts`.

DB migrations live in `supabase/migrations/`, named `NNN_*.sql` — currently through 087. Key recent milestones: 063 cadence_loop, 066 platform_connections, 067 scheduled_posts, 068 metrics_sync, 069 r2_storage, 073 social_drafts_variants, 074 gsc_contentful_providers, 075 seo_posts, 076 outbound_template_type + outreach_campaigns, 077 global_outbound_templates + prospect_follow_up, 078 conversation_analyses, 079 prospect_notes, 080 prospect_enrichment_fields, 081 add_phone_to_prospects, 082 analytics_reports, 083 own_post_metrics_dedup, 084 analytics_import_sessions, 085 event_scraper_runs, 086 content_slots, 087 content_slots_scheduled_date. Apply via Supabase SQL Editor (paste + run) or `supabase db push` after `supabase login --token <pat>` and `supabase link --project-ref <ref>`. The user typically runs migrations by hand in the SQL Editor, so the migration *number* (not the SQL) is what they need from you.

**Duplicate migration numbers exist** (076 and 077 each have two files). When writing new migrations, check the highest actual file number first — don't trust the sequence to be gapless.

When modifying a table, **grep prior migrations first** — retrofits later in the chain can change column shapes/RLS for tables defined earlier (e.g. 002 retrofit affected 009).

One-off tenant cleanup scripts live in `supabase/cleanups/` (e.g. `wipe-tenant-mock.sql` resets seeded mock data for a tenant). Paste into the SQL Editor and run.

## Tech stack

- Next.js 16 App Router, Turbopack, React 19, TypeScript
- Tailwind v4 — palette + scale defined in `globals.css` `@theme` block, no `tailwind.config`
- Supabase: `@supabase/ssr` for SSR auth + cookies, `@supabase/supabase-js` for service-role
- AI SDK v6 (`ai` + `@ai-sdk/openai`) with Zod-based structured outputs; OpenAI `gpt-4.1` / `gpt-4o-mini` / `gpt-4o`
- Tiptap (with Markdown extension) for the blog editor
- shadcn-style primitives at `src/components/ui/` (Button uses CVA + radix Slot, Dialog/Input/Textarea/Label/Card)
- Lucide React for icons
- Vercel deployment (push to `main` triggers deploy)

Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`. Storage (Cloudflare R2): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`. Cron + local-only: `CRON_SECRET`, `SEED_*`. Social publishing: `SOCIAL_API_KEY` (SocialAPI.ai unified publisher — covers Instagram/LinkedIn/TikTok/YouTube, no per-platform reviews, $29/mo Side Hustle plan at social-api.ai), `COMPOSIO_API_KEY` (parallel publish/engagement/insights path per `(tenantSlug, toolkit)` connection — falls back to the SocialAPI.ai path when no Composio connection exists), `PLATFORM_TOKEN_KEY` (32-byte base64 AES key), `NEXT_PUBLIC_APP_URL`. X OAuth (optional, paid only): `X_CLIENT_ID`, `X_CLIENT_SECRET`. YouTube direct OAuth (optional fallback): `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`. Scheduling: `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`. Transactional email: `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, `BREVO_FROM_NAME`, `EMAIL_BASE_URL` (daily/weekly digest + spike-alert emails). Contentful publish target (optional, Gruve-specific fallback): `CONTENTFUL_SPACE_ID`, `CONTENTFUL_CMA_TOKEN`, `CONTENTFUL_ENVIRONMENT`, `CONTENTFUL_DEFAULT_LOCALE`, `CONTENTFUL_TEST_ENVIRONMENT` — per-tenant credentials in `tenant_integrations` take precedence when present.

## Authentication & multi-tenancy

Gated by Supabase Auth; tenancy is real (not just a UI cookie).

**Three Supabase clients** at `src/lib/supabase/`:
- `server.ts createClient()` — SSR client for Server Components / Actions / Route Handlers, reads + writes auth cookies via `next/headers`
- `client.ts createClient()` — browser client for Client Components
- `admin.ts createAdminClient()` — service-role, bypasses RLS, server-only (cross-tenant queries, scripts, cron, API token endpoints)

Every client is a **factory function** — never instantiated at module load (a top-level `createClient()` call breaks Vercel page-data collection if env vars aren't injected at that phase).

**`src/proxy.ts`** is the Next 16 routing middleware (NOT `middleware.ts`). It calls `updateSession()` from `src/lib/supabase/middleware.ts` on every request: refreshes the auth cookie, redirects unauthed users to `/login?next=<pathname>`, and bounces authed users away from `/login` and `/signup` to `/dashboard`.

**Tenant model.** `tenants` table keyed by slug; `memberships(user_id, tenant_slug, role)` with `owner | admin | member`. `invitations` carry an email + role + token; the `accept_invitation(token)` RPC validates and creates the membership. RLS uses `is_tenant_member(slug)` and `tenant_role(slug)` helpers from `002_foundation.sql` — every tenant-scoped table FKs to `tenants(slug)` and gates with these helpers.

Note: `tenants.platforms` is read as a top-level field in types but is actually stored inside the `tenants.settings` JSONB. The `hydrate()` function in `src/lib/services/tenants.ts` flattens it. When updating via SQL, use `jsonb_set` on the `settings` column, not an UPDATE on a `platforms` column.

**Tenant switching** uses the `tenant=<slug>` cookie. Server Components call `getCurrentTenant()` from `src/lib/auth.ts`, which validates the cookie against actual memberships and falls back to the first one.

**Auth helpers** in `src/lib/auth.ts`: `getCurrentUser()`, `requireUser()` (redirects), `getUserTenants()`, `getCurrentTenant()`. Use these instead of reading `auth.getUser()` directly.

**Account type (persona) drives the whole app shell.** `tenants.account_type` (mig 064) is `"startup" | "individual"`, exposed as `AccountType`/`getCurrentTenant().accountType` in `src/lib/auth.ts`. `individual` accounts are onboarded through `/onboarding/personal` instead of `/onboarding/audit` (see the guard in that page) and get a curated sidebar — `navGroupsForAccountType()` in `src/lib/nav-config.ts` drops any `NavItem` whose `surfaces` array excludes the current persona (e.g. SEO, Outbound, Video studio, Ads critic, AI Calendar, and Broadcasts are `startup`-only; Schedule is `individual`-only). `SettingsNav` also branches on `accountType`. When adding a nav item or settings section, decide up front whether it's persona-gated.

## Route groups

```
src/app/
├── layout.tsx            ← minimal root: html/body, ThemeScript, fonts
├── page.tsx              ← redirects to /dashboard
├── proxy.ts              ← auth gate (lives at src/proxy.ts not repo root)
├── onboarding/audit/     ← 60-second brand audit wizard (pre-app)
├── api/                  ← route handlers
│   ├── cron/             (generate-briefs, scrape-trends, weekly-digest — bearer-gated)
│   ├── ext/              (Chrome extension endpoints — tenant-API-token auth, CORS)
│   └── vault/            (media download)
├── (auth)/               ← login, signup — own minimal layout, no sidebar
└── (app)/                ← all protected pages — sidebar + auth check
    ├── layout.tsx        ← runs requireUser(), getUserTenants(), renders sidebar
    ├── settings/         ← has own layout.tsx with inner nav; sections are sub-routes
    ├── (overview)/       (dashboard, own-analytics, weekly-report)
    ├── (content)/        (content-vault)
    ├── (social)/         (engagement, platform-score, viral-trends, ai-content, post-history, video, broadcasts, composer, engage, today, schedule)
    ├── (growth)/         (leads → Outbound rebuild, ads-tracker → Ads Critic, orders)
    ├── (intelligence)/   (intel-feed, content-briefs (redirect), seo-tracker/*, competition)
    ├── conversations/    (unified engagement inbox + join-conversations — reuses (social)/engage + (social)/engagement components)
    └── analytics/        (legacy short-URL: server redirect to /own-analytics, not a second implementation)
```

Route groups don't appear in URLs. The `(app)` group exists so the auth pages don't inherit the sidebar. `/content-briefs` is a server redirect to `/ai-content?tab=briefs` (content merged).

**A route folder existing doesn't mean it's reachable from the sidebar.** `src/lib/nav-config.ts` currently only links Dashboard, Analytics, Signals, SEO, Composer, AI Calendar, Video studio, Schedule, Broadcasts, Post history, Platform score, Ads critic, Conversations, and Outbound. `(social)/engagement`, `(social)/engage`, `(social)/today`, and `(social)/viral-trends` still exist as working pages but aren't linked from the current nav or `SidebarNavItem` — check `nav-config.ts` before assuming a page is orphaned/dead vs. just unlinked.

## Settings

`/settings` has its own `layout.tsx` with an inner nav (`src/components/settings/SettingsNav.tsx`) — left sidebar on desktop, sticky horizontal chip row on mobile. Sections are grouped (Account / Brand / Social signals / Publishing / Integrations & usage), each its own route: `/settings/profile`, `/security`, `/notifications`, `/appearance`, `/team`, `/brand-positioning`, `/brand-voice`, `/brand-audit`, `/x-listening`, `/trend-scouts` (startup), `/discovery` (startup), `/outbound-filters` (startup), `/content-engine` (startup), `/social-publishing`, `/cadence`, `/content-calendar` (individual), `/integrations`, `/system-health`, `/ai-usage`, `/storage`. `SettingsNav` filters items by `accountType` the same way `nav-config.ts` does for the main sidebar — a `surfaces` array per item, omitted meaning shown to both personas. `/settings` redirects to `/settings/profile`. Sub-routes use `SettingsPageHeading` from `./_shared.tsx` for consistency.

## Data layer pattern

```
lib/types/[module].ts        → TypeScript interfaces
lib/services/[module].ts     → Read functions returning Promise<T>, use server client (RLS applies)
lib/actions/[module].ts      → Server Actions ("use server" at top), write paths
lib/ai/[module].ts           → AI generators (structured output + logAiCall telemetry)
lib/integrations/[module].ts → External API wrappers (server-only, e.g. GA4)
```

Components call services, never mock data or Supabase directly. Cross-tenant aggregations (`cross-brand.ts`, cron jobs, `/api/ext/*`) use the admin client.

**Two cross-cutting gotchas (each cost real debugging time):**
1. **Service-role callers fail membership-gated RPCs.** `is_tenant_member(slug)` / `tenant_role(slug)` resolve via `auth.uid()`, which is **null** for the admin/service-role client. So any SECURITY DEFINER RPC that checks `is_tenant_member` (e.g. the `transition_*_status` RPCs) raises `forbidden` when called from cron / a runner / the admin client. System-actor code must apply the same optimistic-version UPDATE + audit INSERT **directly via admin** (which legitimately bypasses RLS), not through the RPC. The video runner's `transitionRunner` is the reference; human-driven actions still use the RPC (real `auth.uid()`).
2. **Server Actions cap request bodies at ~1 MB** (Next) / ~4.5 MB (Vercel) — uploading a real image/video through a Server Action returns 400. The pattern is a **signed upload URL**: a tiny action returns `{path, token}` from `admin.storage.from(bucket).createSignedUploadUrl(path)`, the browser does `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)` (bytes go straight to Supabase), then a second action registers the asset (recomputing the public URL server-side). See `createSignedVideoUpload` / `registerVideoAsset` in `lib/actions/video-generate.ts`.

**Most modules are now Supabase-backed.** The `src/lib/data/mock-*.ts` files still exist but are largely orphaned after the Slice 6/7 rebuild. Real tables now back: blog posts + versions + feedback + regeneration, content distributions, competitors + intel cards + content briefs, trend scouts, own post metrics, weekly digests + reviews, programmatic SEO, coach actions, prospects + outbound DMs + inbound messages + prospect searches, tenant integrations (GA4), tenant API tokens, web analytics daily.

## AI layer

All AI calls go through `src/lib/ai/gateway.ts`:
- `getModel(purpose)` picks the OpenAI model by capability class ("synthesis" → gpt-4.1, "scoring" → gpt-4o-mini, "vision" → gpt-4o)
- `estimateCostUsd(model, usage)` for cost accounting
- `logAiCall(entry)` writes to `ai_call_log` — every AI call must log (success AND failure) with tenant_slug, purpose, feature slug, tokens, cost, duration. Telemetry is what drives `/settings/ai-usage` and the Weekly Review cost line.

**OpenAI strict structured-output gotcha.** When using `generateText({ output: Output.object({ schema: zodSchema }) })`, OpenAI strict mode requires every property to be listed in the `required` array. Zod `.optional()` and `.default()` both produce non-required fields and fail with `"Missing '<field>'"`. Use `.nullable()` instead — fields stay required but can be null. Arrays that can be empty must be present-but-empty, not absent. All current AI schemas are clean; preserve this when adding new ones.

**Brand voice + positioning layer on every AI call.** `getBrandContext(tenantSlug)` in `src/lib/ai/brand-positioning.ts` returns `{voice, positioning}` from `tenants.settings`. `buildPositioningBlock(positioning)` renders a consistent prompt block. AI call paths pull these, stringify into the system prompt, and pass Zod schemas that match the output shape.

## Modules shipped (at a glance)

- **Brand Audit** (Slice 1-2): `/onboarding/audit` — site scrape → brand voice + positioning + competitors + keywords + briefs in one flow.
- **Content Machine** (Slice 3): `src/lib/ai/multiply-content.ts` — blog → 8 channel-native artifacts. `content_distributions` table.
- **AI Coach** (Slice 5): `src/lib/ai/coach.ts` — signal → prioritized actions. `coach_actions` table. Dashboard widget `CoachFeed`, "Ask coach" button on blog editor.
- **Ads Critic**: `src/lib/ai/critique-ad.ts` — no data ingestion; paste creative, get scored critique + rewrite. `/ads-tracker` page.
- **Outbound** (Slice 6): `src/lib/ai/outbound.ts` — qualify prospects + draft DMs. `prospects` / `outbound_dms` / `inbound_messages` / `prospect_searches` tables. Rebuilt `/leads` as pipeline + inbox + discovery.
- **Chrome extension** (Tier 2): `extension/` folder, MV3. Injects "Draft with Pulse" FAB on IG/TikTok/X/LinkedIn profiles. Auths via tenant API tokens (`tenant_api_tokens` table, created at `/settings/integrations`). Endpoints at `/api/ext/*`.
- **GA4 analytics** (Slice 7a): `src/lib/integrations/ga4.ts` — service-account JWT auth, no extra deps. `web_analytics_daily` table. Feeds the Weekly Business Review.
- **Weekly Business Review** (Slice 7a): `src/lib/ai/weekly-review.ts` — synthesizes module counts into a narrative. Dashboard banner, stored on extended `weekly_digests`.
- **Content Pipeline** (P8): `/content-vault/pipeline` — Drive-backed media library with metadata + status + scheduling. Resumable PUT to `/api/integrations/drive/upload-chunk` streams files straight to the user's connected Drive; `content_items` (041) holds the metadata; `042` adds the status enum. Daily `drive-reconcile` cron flags missing/permission-lost files. Drive OAuth lives at `/api/integrations/drive/{connect,callback}`. Tabs: `Extracts` (legacy Saved) + `Pipeline`. The `Saved` directory still exists at `/content-vault/saved` — only the label was renamed.
- **SEO engine**: large module under `seo-tracker/*` (blog-writer, topical-map, serp-analysis, programmatic). Durable publish pipeline `src/lib/seo/publish-runner.ts` (checkpoint steps in a runs/steps table, resume from first non-ok step — the canonical durable-run pattern), optimistic-version status RPC `transition_blog_post_status` (mig 044), a fleet of `seo-*` crons, and a `/.well-known` JWKS path for signing previews that `src/proxy.ts` exempts from auth.
- **Order/attribution spine** (PRD): `/api/orders/webhook` ingests orders; short links `/app/r/[code]` + `keyword-deeplink.ts` attribute traffic; per-tenant scrape config (`src/lib/scrape/discovery-config.ts`, `/settings/discovery`) so each tenant scrapes its own platforms (Gruve = ticketing, Sippy = drinks, etc.) via `scrape-ticketing-platforms` cron; `/settings/system-health` surfaces cron/observability; dashboard `SetupBanner` tracks launch-checklist steps.
- **WhatsApp broadcasts**: `src/lib/integrations/whatsapp.ts` + `/api/integrations/whatsapp` + `lib/actions/broadcasts.ts`, surfaced at `/broadcasts`.
- **Social Publishing Engine**: multi-platform post scheduling. `platform_connections` table (mig 066) stores SocialAPI.ai account IDs (not OAuth tokens) per `tenant_slug + platform`. `scheduled_posts` table (mig 067) holds posts; QStash delivers them at the right time via `/api/webhooks/qstash-publish`. After publishing, the webhook stores the platform-native post ID in `platform_post_id` AND the SocialAPI post ID in `source_api_post_id` (mig 068 — needed for metrics lookup). YouTube uses direct OAuth (`YOUTUBE_CLIENT_ID/SECRET`); Instagram/LinkedIn/TikTok route through SocialAPI.ai (`SOCIAL_API_KEY`). Settings UI at `/settings/social-publishing`. Scheduling actions at `src/lib/actions/schedule.ts`. `platform_connections.access_token_enc = 'socialapi-managed'` is the sentinel for SocialAPI-backed rows. **`scheduled_posts` real schema** (mig 067): `id, tenant_slug, connection_id, platform, content, media_paths, scheduled_for, posted_at, platform_post_id, platform_post_url, source_api_post_id, status (draft|scheduled|publishing|published|failed), error_message, source, source_draft_id, qstash_message_id, created_by, created_at` — the service at `src/lib/services/scheduled-posts.ts` and type at `src/lib/types/scheduled-posts.ts` must match this exactly (past mismatch caused silent empty-calendar bugs).
- **Engagement metrics sync**: daily cron at `/api/cron/sync-post-metrics` calls `GET /v1/posts/{source_api_post_id}/metrics` (SocialAPI.ai) and upserts likes/comments/shares/saves into `own_post_metrics` with `source = 'api'`. `own_post_metrics` now has a `scheduled_post_id` FK + unique index on `(scheduled_post_id, platform)` for upsert dedup (mig 068). `src/lib/integrations/socialapi.ts` exposes `getPostMetrics()`.
- **Composer**: `/composer` — AI-assisted post drafting per platform. `src/lib/actions/compose.ts` + `src/lib/ai/compose-take.ts`. Accepts `?angle=` (pre-filled prompt), `?date=YYYY-MM-DD` (pre-sets schedule date + shows "Drafting for" chip). Shows "Connect accounts →" CTA in the schedule accordion when no `platform_connections` exist. X publishing is disabled (paid OAuth plan required) — X card is copy-only. Drafts can be scheduled via `schedulePost()` / `publishNow()`.
- **Engage**: `/engage` — discover and reply to conversations. `src/lib/services/engage.ts` + `src/lib/ai/engage.ts` (generic cross-platform draft generator — distinct from the X-specific `src/lib/ai/x-engage.ts` used by X Listening). `engage_candidates` table (mig 065). Currently reached via `/conversations`, not linked directly in the sidebar.
- **Content Calendar**: `/ai-content` tab — interactive week grid (`src/app/(app)/(social)/ai-content/CalendarView.tsx`, client component). Accepts a 4-week range of `ScheduledPost[]` and navigates client-side without refetching. Empty days show a `?date=` pre-filled Composer link. Intel Feed "Steal This →" and Viral Trends "Draft" buttons both route to `/composer?angle=...` with pre-filled context.
- **Today**: `/today` — daily cadence dashboard showing today's posting windows and what's behind. Not currently linked in the sidebar nav.
- **Cadence loop**: posting-rhythm engine. Config stored in `tenants.settings.cadence` (JSONB, same `jsonb_set` pattern as `platforms`). `src/lib/cadence/` — `types.ts` (Zod schemas), `config.ts` (reader), `compute.ts` (tracker math), `digest.ts` (daily digest email). `cadence_log` table (mig 063). Settings UI at `/settings/cadence` (`CadenceEditor` component). Daily digest cron at `/api/cron/cadence-digest`. Cadence currently targets X and LinkedIn only (see `cadencePlatforms` in `types.ts`).
- **Video Generation Engine** (see its own section below).
- **Analytics** (social import): `/own-analytics` — upload JSON/HTML exports from TikTok and Instagram; parses into `analytics_import_sessions` (mig 084) and `analytics_reports` (mig 082). `/analytics` is just a redirect stub to `/own-analytics` (kept for a legacy short URL) — don't confuse the two. Own-post metrics also sync via the `sync-post-metrics` cron.
- **Composio** (parallel publish/engagement/insights path): `src/lib/composio/{client,executors,resolve-alias}.ts` wraps `composio.tools.execute()` for Instagram/LinkedIn/TikTok, resolved per `(tenantSlug, toolkit)` from `connected_accounts`. Falls back to the existing SocialAPI.ai path when no Composio connection exists for that toolkit. Two crons consume it: `composio-sync-engagement` (comments/DMs → `engagement_items`/`inbound_messages`) and `composio-sync-insights` (reach/impressions/likes → `posts`, for posts published via provider `composio`). Settings UI: `/settings/social-publishing` + `/settings/integrations` connected-accounts panel.
- **Email digests**: Brevo-backed (`src/lib/email/brevo.ts`). `daily-email` cron renders scheduled posts + intel cards per tenant; `weekly-email` cron sends unsent `weekly_digests` rows (`email_sent_at is null`) an hour after weekly-digest generation; `spike-alert-email` runs hourly and emails when an `intel_cards` metric spikes ≥3x average in the last 2 hours. Recipients resolve via `memberships`. Settings UI: `/settings/notifications`. Note: `src/lib/integrations/brevo.ts` is a separate, older Brevo client used for invite/OTP auth emails — don't conflate the two.
- **Conversations** (`/conversations`): a unified landing page, not a new subsystem — re-hosts the `(social)/engagement` inbox and `(social)/engage` "join conversations" UI as two tabs. Unrelated to `conversation_analyses` (mig 078), which belongs to Outreach Intelligence instead.
- **Outbound templates** (scenario-driven): `outbound_templates` table extended with `template_type` (mig 076 — 9 types: `cold_open`, `follow_up_1`, `follow_up_2`, `post_event`, `event_confirmed`, `promised_reminder`, `re_engagement`, `value_add`, `objection_response`) and global templates pattern (mig 077 — `tenant_slug` nullable + `is_global boolean`, XOR CHECK). Global templates have `tenant_slug = NULL`; RLS allows all authenticated users to read them. New tenants auto-inherit all 9 defaults. `[COMPANY]` token fills from `tenant.name`. See `supabase/cleanups/seed-outbound-templates.sql` to seed. AI personalisation: `src/lib/ai/personalize-template.ts` + `personalizeTemplate` action.
- **Outreach Intelligence**: `outreach_campaigns` (mig 076), `prospect_follow_ups` (mig 077), `conversation_analyses` (mig 078), `prospect_notes` (mig 079), prospect enrichment fields (mig 080 — adds `phone`, company/role metadata). Services at `src/lib/services/outreach-campaigns.ts` + `src/lib/services/outreach-intelligence.ts`.
- **Event Platform Lead Scraper** (Outbound add-on): scrapes event/ticketing platforms for organizers currently running **paid/ticketed** events (free/RSVP-only excluded) so the Outbound team can pitch them to switch to Gruve. Sibling to the existing Apify-based `scrape-ticketing-platforms` cron (Jetron/Eventbrite/Luma/Tix.africa — untouched), NOT a replacement: new platforms (currently Shows.ng + eGotickets confirmed working; Syticks/Obodo/Unboxd/Tiqbuy/Tixvnt on a best-effort JSON-LD fallback) are crawled by a **self-hosted** fetcher (`src/lib/scrape/event-fetch.ts` + cheerio, `src/lib/scrape/event-platforms/*`) — no Apify, no proxy by default (cost constraint; a proxy is added only if a platform is actually observed blocking requests). Organizer social handles resolve via the existing Serper/SERP fallback, same as the rest of Outbound. `event_scraper_runs` + `event_scraper_run_steps` (mig 085) track one row per platform per run — for BOTH the old Apify platforms and the new in-house ones, unifying them in the `/leads` "discovery" tab's new **Event platform scrapers** section (expandable run history + manual "Run now"). New cron: `scrape-event-platforms` (30 3 * * *). TixTango, Clooza, Partyverse, and Eventpadi were researched but are NOT scraped — see `src/lib/scrape/event-platforms/index.ts`'s `RESEARCHED_NOT_BUILT` for why (client-rendered SPAs needing Playwright, or anti-bot/broken-TLS blocked at the network layer) — Playwright was deliberately not added to keep this feature at ~$0 net-new infra cost.
- **X listening / signal cache**: `x_listening` (mig 071) + `x_signal_ai_cache` (mig 072) — stores X posts matching brand keywords, AI-scored for signal quality. Feeds the Engage tab and Outbound discovery.
- **Social drafts variants** (mig 073): `social_draft_variants` table — alternative takes on a draft, linked to `scheduled_posts`. Used by the Composer A/B flow.
- **SEO posts + GSC/Contentful providers** (mig 074–075): `seo_posts` tracks programmatic SEO content items. `gsc` and `contentful` added to the `tenant_integrations` provider enum. Contentful (`src/lib/integrations/contentful.ts`, `contentful-management` CMA client) is a real publish target — pushes approved drafts into Gruve's `gruveBlog`/`seoLandingPage` content types, per-tenant credentials from `tenant_integrations` falling back to env vars, idempotent via a `fields.pulseId` lookup. `pnpm check:contentful` validates the target space's field IDs before publishing. AI-search visibility (GEO/AEO) is tracked separately via `src/lib/integrations/ai-visibility.ts` (Perplexity citation check) + `src/lib/seo/ai-visibility-sync.ts`.
- **Content calendar** (individual persona): `/content-calendar` — see its own section below.

The 100x product roadmap is `docs/pulse-100x-roadmap.md`. Long-form context for the most recent roadmap items lives in `TODOS.md` under `## P8`.

## Video Generation Engine

Turns approved content (or a free-text prompt) into short-form video on ByteDance **Seedance** via the **PicsArt GenAI API**. Lives under `/video` (composer + history), `/video/[id]` (project detail + editable storyboard), `/video/characters` (reusable character registry — the moat). Migrations **060–062**; tables `video_projects / video_clips / video_characters / video_assets / video_generation_runs(+_steps) / video_render_jobs`, plus `ai_call_log.credits`.

- **Provider boundary.** `src/lib/video/providers/types.ts` defines `VideoProvider`; `picsart.ts` is the ONLY file touching the PicsArt API (`https://genai-api.picsart.io`, header `X-Picsart-API-Key`). A provider swap = one new file. The module is dormant until `PICSART_API_KEY` is set (`isPicsartConfigured()` graceful-degrades).
- **PicsArt API surface is small and fixed:** only `POST /v1/text2video` and `POST /v1/image2video` (→ `202 {inference_id}`, poll `GET /v1/video/{id}`), plus `GET /v1/balance` → `{credits}`. There is **no video-to-video / "recreate" endpoint and no per-job cost/history** — `image2video` takes an image only, never a source video. The composer's "Recreate" mode is therefore disabled ("Soon"); true v2v would require a different provider (e.g. fal reference-to-video).
- **Durable runner.** `src/lib/video/video-generation-runner.ts` clones the SEO publish-runner pattern. Driven by `GET /api/video/projects/[id]/status` (client polls ~5s) + the `video-maintenance` cron backstop.
- **Credits are estimates, not truth.** `estimateSeedanceCredits()` in `providers/seedance-constraints.ts` is `(baseCredits + creditsPerSecond·s)·resMult` — calibrated, NOT exact. PicsArt deducts the real amount on generate and exposes no dry-run price. The budget gate (`src/lib/video/budget.ts`) enforces the live `/v1/balance` AND the USD ceiling; `scripts/calibrate-credits.ts` (balance before/after one clip) refines the rates after a top-up. Real Seedance cost is high (a 1s/480p Pro clip already exceeds 50 credits).

## Content Calendar (individual persona)

`/content-calendar` — a topic + research-briefing engine for solo creators who know they want to post but don't know what to say. Gated by `surfaces: ["individual"]` in `nav-config.ts` **and** a tenant-slug allowlist (`src/lib/content-calendar/tenant-config.ts`, currently just `aiseosa-space` — personal dogfood, not generalized to other individual-persona signups or to the startup persona; see `TODOS.md` P9). Deliberately does NOT reuse Trend Scouts/Intel Feed/X Listening for trend-sourcing — a small parallel pipeline instead, to avoid coupling this unvalidated single-tenant feature to infra Gruve/Sippy depend on.

- **Data model.** `content_slots` table (mig 086, `scheduled_date` added in 087): `position, scheduled_date, status (assigned|in_progress|filmed|posted|skipped), topic_title, topic_brief jsonb, notes, video_asset_url, platforms[]`. `scheduled_date` is provisional, not fixed — `src/lib/services/content-calendar-lifecycle.ts` rolls any open slot whose date has passed forward to today on every read (`rolloverOverdueSlots`), and auto-retires slots stale past a grace window to `skipped` (`retireStaleSlots`). `position` stays the same-day ordering tiebreaker.
- **Config** lives in `tenants.settings.contentCalendar` (JSONB, same pattern as `cadence`/`discovery`): `niches` (plural — "content pillars," e.g. "AI tools"/"startups"; a legacy single-`niche` string auto-migrates on read), `interestTags`, `postsPerDay` (1-5, controls how many slots a fresh batch packs onto one day before advancing — `Math.floor(i / postsPerDay)` in the date-assignment math), `recentFeedback` (rolling log of stated regenerate-reasons, see below). Settings UI at `/settings/content-calendar`; **`saveContentCalendarConfig` merges into the existing `contentCalendar` object rather than replacing it wholesale** — a prior bug where it replaced the whole object would silently wipe `recentFeedback` on every settings save.
- **Two AI calls per slot** (`src/lib/ai/content-calendar.ts`): `selectTopic` (cheap "scoring" tier — picks a topic + pillar from trends/interests) then `generateBriefing` (synthesis tier, grounded in real SERP results fetched between the two calls — talking points, `whyItMatters` one-line orientation, a sourced stat, a contrarian angle, reference links, and "how others are covering this" creator examples with a broader-query retry if the first search returns empty). Every stat carries a real source URL, never a hallucinated one.
- **Batch generation** (`generateNextBatch` in `src/lib/actions/content-calendar.ts`, capped at `MAX_BATCH_SIZE`, run synchronously — no durable-runner table, batch size is small enough not to need the SEO/video runners' checkpointed pattern): topic-selection runs **sequentially**, not concurrently, so each pick sees every prior pick's title *and* pillar before choosing — concurrent picks raced on a shared exclude list and produced duplicate/rephrased topics in production. Briefing generation, which has no cross-slot dependency, runs concurrently via `mapWithConcurrency`. Pillars rotate across a batch rather than clustering on whichever trends hardest.
- **Manual/reactive scheduling**, on top of the normal batch queue: `getTrendPreview` surfaces the raw per-niche trend feed with zero AI cost (same `fetchTrendCandidates` HN/Serper pull the batch action uses) so the creator can see the landscape before generating; `createSlotFromTrend` pins a clicked trend headline straight to a specific date, skipping the topic-selection AI call entirely since the human already chose the topic; `createSlotForDate` does the same from a free-text instruction instead of a clicked trend. `deleteSlot` hard-deletes a row — distinct from marking a slot `skipped`, which keeps a visible record.
- **Learning loop, half-closed by design.** `appendContentCalendarFeedback` logs every stated regenerate-reason into `recentFeedback`, fed back into future `selectTopic` prompts (verified: a repeated "too technical" pattern for a pillar shows up in the next pick's system prompt). The other half — correlating actual post-performance metrics back into topic selection — is deliberately deferred (`TODOS.md` P9): it needs weeks of real posting history to correlate against, which doesn't exist yet for a same-day-shipped feature.
- Daily email cron (`/api/cron/content-calendar-email`, separate from the startup-persona `daily-email` cron for blast-radius reasons) emails the next unposted slot each morning, or a "generate more" nudge if the queue is empty — the in-app page mirrors that same empty-queue nudge rather than rendering a blank grid.
- Video upload reuses only the signed-upload-URL R2 mechanism from `video-generate.ts`, not its `video_assets` table (different lifecycle — a founder's manual upload, not an AI-rendered clip). LLM eval suite deliberately deferred — the founder's own usage is the eval for now.

## Theming

Light is default (`ThemeScript` in root layout sets `class="dark"` only when `localStorage["pulse-theme"] === "dark"`, before first paint). Users opt into dark via Settings → Appearance.

The Gruve light palette + full token scale are in `globals.css` `@theme`. The `html.dark` block overrides every relevant token. Utilities like `bg-card`, `text-gray-1100`, `bg-primary-50`, `border-white-200` are theme-aware automatically.

**Dark mode keeps Gruve red as the brand color.** See `DARK-THEME.md` for the palette spec.

**Recurring footguns:**
1. `text-white` is *not* theme-aware (Tailwind built-in = literal `#ffffff`). Use `text-foreground` for body text on cards. `text-white` is correct only on colored backgrounds.
2. `bg-white` is also literal. Use `bg-card` for theme-tracking surfaces.
3. **Modal scroll regions need `h-[Xvh]`, not `max-h-[Xvh]`.** Percentage heights (`h-full`) only resolve when every ancestor has a *definite* height. `max-h` alone makes the container content-sized until it overflows, which collapses `h-full` on inner scroll regions to `auto` and breaks `overflow-y-auto`. See `UploadModal.tsx` — the metadata phase uses `h-[90vh]` so the sidebar's `overflow-y-auto` actually has bounded content to clip.
4. **Don't use inline `ref={(el) => ...}` callbacks for `scrollIntoView`.** React re-creates the lambda each render → ref re-fires → element scrolls back, blocking manual scrolling. Use a stable ref + `useEffect` keyed on the trigger value (see `UploadModal` `desktopActiveRef`).
5. **Native datetime-local picker icons are stubborn.** `[&::-webkit-calendar-picker-indicator]:hidden` + `onClick={(e) => e.currentTarget.showPicker?.()}` is the reliable way to hide the native indicator and replace it with a custom icon. `opacity:0` + `flex-1` tricks were unreliable across webkit builds. See `UploadModal` Post-schedule input.
6. **`bg-primary` / `border-primary` without a shade number has no token in Tailwind v4.** Always use `bg-primary-500`, `border-primary-500`, `text-primary-500` etc. Bare `bg-primary` silently produces a transparent background — text on it becomes invisible.

## Sidebar navigation

Items in `src/lib/nav-config.ts` (typed as `NavGroup[]` of `NavItem`, grouped by job-to-be-done — Home → Discover → Create → Publish → Measure → Connect — not by feature area). Icon names map to Lucide imports in `components/sidebar/SidebarNavItem.tsx` via `iconMap`. An item with no `surfaces` shows to both personas; set `surfaces: ["startup"]` or `["individual"]` to persona-gate it (see account-type note above). To add a nav item: edit nav-config, decide its `surfaces`, and add the Lucide icon to the import + the `iconMap`.

## Design system

- **Light** — `GRUVE-DESIGN.md` is the canonical spec (maroon `#ad112c`, Satoshi @font-face, pill buttons, rounded-lg inputs, rounded-2xl cards, blue focus rings, no in-app gradients).
- **Dark** — `DARK-THEME.md` documents the dark palette, surface hierarchy, and conversion rules.
- **Dialogs** — always use the `Dialog` / `useDialogs` primitives from `src/components/ui/Dialog.tsx`. Never `window.confirm/alert/prompt`.
- **Toasts** — `toast.success/error(...)` from `src/components/ui/Toaster.tsx`. The `<Toaster />` is mounted once in `(app)/layout.tsx`.
- **Inline cell editors** — `StatusPill`, `InlineSchedulePicker`, `InlineAssigneePicker`, `InlineTypePicker` (under `content-vault/pipeline/_components/`) all share a portaled-popover pattern: `useLayoutEffect` measures the trigger rect, `createPortal(menu, document.body)` renders fixed-position so the menu is never clipped by the table's `overflow-x`. When adding a new inline editor, copy this pattern — anything inline-rendered will get clipped.
- **Fonts** — `@font-face` references `/public/fonts/Satoshi-{Regular,Medium,Bold,Black}.woff2`. Files aren't in the repo; falls back to system sans-serif until dropped in.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill tool as your FIRST action. Do NOT answer directly or use other tools first.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
