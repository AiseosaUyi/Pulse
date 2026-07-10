# Pulse — Project Overview

> A condensed handoff doc you can paste into ChatGPT (or any LLM) for context on Pulse before asking questions about it.

## What Pulse is

**Pulse is a multi-tenant marketing operations platform** built for small brand teams that need to run a full content + growth motion without juggling 8 SaaS tools. One workspace per brand; multiple brands can live under one account. Today it powers **Gruve** (events ticketing platform — `gruvetickets`) and **Sippy** (`sippy_official`), plus a personal workspace.

The product spans the full marketing loop:

1. **Audit** — 60-second brand audit on signup (site scrape → voice, positioning, competitors, keywords).
2. **Plan** — content briefs derived from brand voice + intel feed signals.
3. **Create** — blog editor (Tiptap), AI-assisted captions, multi-platform content distribution.
4. **Distribute** — schedule + publish to IG, TikTok, LinkedIn (X paused — paid API).
5. **Engage** — unified inbox for comments + DMs, AI-drafted replies, Chrome extension for in-the-wild composition.
6. **Grow** — outbound prospect discovery, qualification, DM drafting; ads critique.
7. **Measure** — per-post insights, GA4 web analytics, weekly business-review narratives.

## Tech stack

- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript**
- **Tailwind v4** — palette in `globals.css` `@theme` block, no `tailwind.config.js`
- **Supabase** (Postgres + Auth + RLS) — `@supabase/ssr` for SSR cookies, service-role admin client for cross-tenant work
- **AI SDK v6** with OpenAI (`gpt-4.1` / `gpt-4o-mini` / `gpt-4o`); Zod-strict structured outputs
- **Tiptap** (with Markdown extension) for the blog editor
- **shadcn-style** UI primitives at `src/components/ui/` (CVA + radix Slot)
- **Lucide** icons
- **Vercel** deployment (push to `main` deploys)

External services:

- **Apify** — IG, TikTok, Eventbrite, SERP, generic web crawls (discovery / trends)
- **Serper.dev** — Google SERP (primary; Apify is fallback)
- **Brevo** — transactional email
- **Cobalt** (self-hosted on Render) — IG/YouTube/X/Facebook media downloads
- **OpenAI** — all generative + scoring AI
- **Composio** — newly wired for IG/LinkedIn/TikTok OAuth + tool execution (engagement, publishing, insights)
- **Ayrshare** — present in `tenant_integrations` schema for cross-platform posting (executor not yet wired)

## Multi-tenancy model

- `tenants(slug primary key, name, settings jsonb)` — one row per brand workspace
- `memberships(user_id, tenant_slug, role)` with `owner | admin | member`
- `invitations` carry email + role + token; `accept_invitation(token)` RPC creates the membership
- **RLS is real** — every tenant-scoped table FKs `tenants(slug) on delete cascade`. Two helpers gate access:
  - `is_tenant_member(slug)` — read-side gate
  - `tenant_role(slug)` — owner/admin gating for sensitive surfaces (integrations, API tokens)
- **Tenant switching** = `tenant=<slug>` cookie. `getCurrentTenant()` validates against memberships; falls back to first.

## Code layout (data flow)

```
src/lib/types/[module].ts        → TypeScript interfaces
src/lib/services/[module].ts     → Read functions; SSR client (RLS applies)
src/lib/actions/[module].ts      → Server Actions ("use server"); writes
src/lib/ai/[module].ts           → AI generators (Zod + logAiCall telemetry)
src/lib/integrations/[module].ts → External API wrappers (server-only)
src/lib/scrape/[module].ts       → Apify + Cobalt + Serper wrappers
src/lib/composio/[module].ts     → Composio client + executors + alias resolver
```

Components call services, never mock data or Supabase directly. Cross-tenant aggregations (cron, API token endpoints) use the admin client.

```
src/app/
├── onboarding/audit/     — 60-second brand audit wizard
├── api/
│   ├── cron/             — bearer-gated; trends, briefs, prospects, insights
│   ├── ext/              — Chrome extension; tenant API token auth + CORS
│   └── vault/            — media download
├── (auth)/               — login, signup
└── (app)/                — sidebar + auth guard
    ├── settings/         — profile, team, integrations, brand voice/positioning, etc.
    ├── (overview)/       — dashboard, own analytics, weekly review
    ├── (content)/        — content vault
    ├── (social)/         — engagement inbox, viral trends, AI content, post history
    ├── (growth)/         — leads (Outbound), ads-tracker (Ads Critic)
    └── (intelligence)/   — intel feed, content briefs, SEO tracker, competition
```

## Key tables (40+ migrations, currently through 038)

| Table | What it holds |
|---|---|
| `tenants`, `memberships`, `invitations`, `profiles` | Identity + tenancy |
| `posts` | Published-post history per platform with reach/impressions/likes/comments/shares/saves |
| `scheduled_posts`, `scheduled_post_publications` | Calendar layer + publish telemetry |
| `content_briefs`, `content_distributions` | AI-generated briefs and channel-native artifacts (IG caption, TikTok script, LinkedIn post, X thread, etc.) |
| `blog_posts`, `blog_versions`, `blog_publications` | Tiptap blog editor + version history + publish to WordPress/Ghost |
| `engagement_items` | Unified inbox: comments, DMs, mentions, replies across platforms |
| `inbound_messages`, `outbound_dms`, `prospects`, `prospect_searches` | Outbound pipeline |
| `tenant_integrations` | Encrypted per-tenant credentials (Ayrshare, WordPress, Ghost, Resend, GA4) |
| `tenant_api_tokens` | First-party API tokens for the Chrome extension |
| `web_analytics_daily` | GA4-pulled site traffic |
| `coach_actions` | AI coach prioritized actions |
| `intel_cards`, `competitors`, `trend_scouts` | Intelligence feed signals |
| `weekly_digests`, `own_post_metrics` | Weekly business review inputs |
| `ai_call_log` | Per-call AI telemetry (model, tokens, cost, duration, tenant) |
| `connected_accounts` | **NEW** — Composio OAuth metadata (tenant → toolkit → alias mapping) |

## Composio integration (newest layer)

Pulse just gained native social OAuth + tool execution via Composio. The integration sits beside the Apify scraping path (which still owns discovery/trending) and the eventual Ayrshare publish path.

**What Composio unlocks today:**

- **Instagram** (Business/Creator accounts only): publish photos/videos/reels/carousels, read + reply to comments, read + send DMs, fetch per-post + account-level insights, mark conversations seen
- **LinkedIn**: publish text + article posts, comment on posts, fetch share stats, network/company info
- **TikTok**: publish video + fetch publish status, list videos, user stats (TikTok's official API is publish-only — no comments/DMs/trending)

**What Composio cannot fix:**

- IG/TikTok public hashtag or account search (closed APIs — Apify still owns this)
- Trending feeds on any platform
- Outbound DMs to users who haven't messaged us first (Meta 24h rule)
- LinkedIn outbound DMs or people-search (Sales Navigator partner only)
- X/Twitter — toolkit exists but requires bring-your-own developer keys + paid tier ($100+/mo)

**Multi-account model**: one Composio org with three aliases — `gruve`, `sippy`, `personal`. Each alias holds its own per-platform OAuth tokens. The `connected_accounts` table maps `(tenant_slug, toolkit) → alias` so server actions can resolve which alias to execute against per workspace.

**Cron syncs:**

- `composio-sync-engagement` (every 10 min) — pulls IG comments + DMs into `engagement_items` and `inbound_messages`
- `composio-sync-insights` (hourly) — fetches per-post stats for IG/LinkedIn/TikTok, updates `posts` rows

## AI conventions

- All calls go through `src/lib/ai/gateway.ts`. `getModel(purpose)` picks model by capability class (synthesis / scoring / vision). Every call **must** `logAiCall()` to `ai_call_log` (success and failure), so usage and cost roll up to `/settings/ai-usage` and the Weekly Review.
- Brand voice + positioning are pulled via `getBrandContext(tenantSlug)` (from `tenants.settings`) and stitched into every system prompt — outputs always sound like the tenant's brand.
- OpenAI strict mode requires every property in the `required` array. Use `.nullable()` (not `.optional()` / `.default()`) in Zod schemas — required-but-nullable fields work, optional fields fail with `"Missing '<field>'"`.

## Modules shipped (at a glance)

| Module | What | Files |
|---|---|---|
| Brand Audit | Site → voice, positioning, competitors, keywords, briefs | `/onboarding/audit` |
| Content Machine | Blog → 8 channel-native artifacts | `src/lib/ai/multiply-content.ts` |
| AI Coach | Signals → prioritized actions, dashboard feed | `src/lib/ai/coach.ts` |
| Ads Critic | Paste creative → scored critique + rewrite | `src/lib/ai/critique-ad.ts` |
| Outbound | Discover + qualify prospects + draft DMs | `src/lib/ai/outbound.ts`, `/leads` |
| Chrome extension | "Draft with Pulse" FAB on IG/TikTok/X/LinkedIn | `extension/` (MV3) |
| GA4 analytics | Service-account JWT pull → `web_analytics_daily` | `src/lib/integrations/ga4.ts` |
| Weekly Review | Module counts → narrative banner | `src/lib/ai/weekly-review.ts` |
| Composio engagement + publishing | IG/LinkedIn/TikTok native OAuth + execution | `src/lib/composio/`, `connected_accounts` table |

## API v1 + MCP server

`/api/v1/*` is a versioned, scoped, token-authenticated REST API — separate from `/api/ext/*` (which stays Chrome-extension-only, unscoped, untouched) — built so external AI "operator" skills (sales, content, SEO, social, analytics) can drive Pulse server-to-server without a browser session. Auth: `Authorization: Bearer pulse_ext_...` against a `tenant_api_tokens` row, least-privilege scopes (`sales:read`, `publish:write`, etc.) enforced per route via `requireApiContext()`. `GET /api/v1/manifest` is machine-readable self-discovery for every endpoint. A parallel **remote MCP server** at `/api/mcp` (`src/app/api/[transport]/route.ts`, built on `mcp-handler`) exposes the identical capabilities as MCP tools sharing the same auth/service layer, for AI sandboxes (Anthropic Cowork) with no outbound internet — the MCP transport is required there, plain HTTP isn't reachable. Full reference: **`docs/API-V1.md`**. Shipped so far: Meta + Sales/outbound + Publishing + Engagement, both as REST and as 20 MCP tools. Content, SEO, Intelligence, and Analytics groups ship as follow-up PRs (REST + MCP together per group). Building/testing the Publishing group surfaced and fixed two pre-existing production bugs — see `docs/API-V1.md`'s "Production bugs found and fixed" section.

## Engineering footguns to remember

1. **Factory clients only** — never instantiate Supabase or Composio at module load. Vercel's page-data collection runs before env vars are guaranteed; top-level `createClient()` calls break the build.
2. **`text-white` and `bg-white` are literal**, not theme-aware. Use `text-foreground` and `bg-card` for theme tracking.
3. **Migration audit before schema changes** — `grep` all prior migrations for the table being touched. Migration 002 retrofits caught out 009; this is a real footgun.
4. **Tenants.platforms isn't a column** — it lives in `tenants.settings` JSONB. Read via `hydrate()` in `src/lib/services/tenants.ts`; write via `jsonb_set` on `settings`.
5. **`src/proxy.ts`** is the Next 16 routing middleware (NOT `middleware.ts` at repo root).
6. **Dialogs**: always `useDialogs` from `src/components/ui/Dialog.tsx`. Never `window.confirm/alert/prompt`.

## Where to look first

- **`CLAUDE.md`** at repo root — full engineering guide (this doc is a strict subset)
- **`CONTEXT.md`** — narrative context, decisions, history
- **`docs/pulse-100x-roadmap.md`** — what's shipped vs pending
- **`docs/API-PRICING-GUIDE.md`** — costs of every external integration + free alternatives
- **`GRUVE-DESIGN.md`** + **`DARK-THEME.md`** — design system specs
- **`supabase/migrations/`** — chronological schema (currently 001 → 038)

## Current state (May 2026)

- ~38 migrations applied, ~30 modules shipped
- Two production tenants live: Gruve (gruvetickets) and Sippy (sippy_official)
- Composio integration just landed — 5 of 8 OAuth connections ready to authorize (IG×2 + LinkedIn×3); TikTok×3 blocked on TikTok developer-app review
- Twitter/X intentionally deferred (paid API budget gate)
