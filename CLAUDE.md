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
```

Single test: `pnpm test tests/unit/foo.test.ts`. Tests live under `tests/unit`, `tests/integration`, `tests/smoke`, `tests/e2e`. Playwright config at `playwright.config.ts`, Vitest at `vitest.config.ts`.

DB migrations live in `supabase/migrations/`, named `NNN_*.sql` — currently through 062. Apply via Supabase SQL Editor (paste + run) or `supabase db push` after `supabase login --token <pat>` and `supabase link --project-ref <ref>`. The user typically runs migrations by hand in the SQL Editor, so the migration *number* (not the SQL) is what they need from you.

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

Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`. Storage (Cloudflare R2): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`. Cron + local-only: `CRON_SECRET`, `SEED_*`.

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
    ├── (social)/         (engagement, platform-score, viral-trends, ai-content, post-history, video, broadcasts)
    ├── (growth)/         (leads → Outbound rebuild, ads-tracker → Ads Critic, orders)
    └── (intelligence)/   (intel-feed, content-briefs (redirect), seo-tracker/*, competition)
```

Route groups don't appear in URLs. The `(app)` group exists so the auth pages don't inherit the sidebar. `/content-briefs` is a server redirect to `/ai-content?tab=briefs` (content merged).

## Settings

`/settings` has its own `layout.tsx` with an inner nav (`src/components/settings/SettingsNav.tsx`) — left sidebar on desktop, sticky horizontal chip row on mobile. Each section is its own route (`/settings/profile`, `/settings/team`, `/settings/security`, `/settings/appearance`, `/settings/notifications`, `/settings/brand-voice`, `/settings/brand-positioning`, `/settings/trend-scouts`, `/settings/integrations`, `/settings/ai-usage`, `/settings/storage`). `/settings` redirects to `/settings/profile`. Sub-routes use `SettingsPageHeading` from `./_shared.tsx` for consistency.

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
- **Video Generation Engine** (see its own section below).

The 100x product roadmap is `docs/pulse-100x-roadmap.md`. Long-form context for the most recent roadmap items lives in `TODOS.md` under `## P8`.

## Video Generation Engine

Turns approved content (or a free-text prompt) into short-form video on ByteDance **Seedance** via the **PicsArt GenAI API**. Lives under `/video` (composer + history), `/video/[id]` (project detail + editable storyboard), `/video/characters` (reusable character registry — the moat). Migrations **060–062**; tables `video_projects / video_clips / video_characters / video_assets / video_generation_runs(+_steps) / video_render_jobs`, plus `ai_call_log.credits`.

- **Provider boundary.** `src/lib/video/providers/types.ts` defines `VideoProvider`; `picsart.ts` is the ONLY file touching the PicsArt API (`https://genai-api.picsart.io`, header `X-Picsart-API-Key`). A provider swap = one new file. The module is dormant until `PICSART_API_KEY` is set (`isPicsartConfigured()` graceful-degrades).
- **PicsArt API surface is small and fixed:** only `POST /v1/text2video` and `POST /v1/image2video` (→ `202 {inference_id}`, poll `GET /v1/video/{id}`), plus `GET /v1/balance` → `{credits}`. There is **no video-to-video / "recreate" endpoint and no per-job cost/history** — `image2video` takes an image only, never a source video. The composer's "Recreate" mode is therefore disabled ("Soon"); true v2v would require a different provider (e.g. fal reference-to-video).
- **Durable runner.** `src/lib/video/video-generation-runner.ts` clones the SEO publish-runner pattern. Driven by `GET /api/video/projects/[id]/status` (client polls ~5s) + the `video-maintenance` cron backstop.
- **Credits are estimates, not truth.** `estimateSeedanceCredits()` in `providers/seedance-constraints.ts` is `(baseCredits + creditsPerSecond·s)·resMult` — calibrated, NOT exact. PicsArt deducts the real amount on generate and exposes no dry-run price. The budget gate (`src/lib/video/budget.ts`) enforces the live `/v1/balance` AND the USD ceiling; `scripts/calibrate-credits.ts` (balance before/after one clip) refines the rates after a top-up. Real Seedance cost is high (a 1s/480p Pro clip already exceeds 50 credits).

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

## Sidebar navigation

Items in `src/lib/nav-config.ts` (typed). Icon names map to Lucide imports in `components/sidebar/SidebarNavItem.tsx` via `iconMap`. To add a nav item: edit nav-config and add the Lucide icon to the import + the iconMap.

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
