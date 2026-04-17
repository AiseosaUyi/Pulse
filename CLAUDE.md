# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start dev server (localhost:3000)
pnpm build      # Production build (also runs the TypeScript check)
pnpm lint       # ESLint
pnpm db:seed    # One-time founder + Gruve/Sippy seed (reads SEED_* + SUPABASE_* from .env.local)
```

DB migrations live in `supabase/migrations/`, named `NNN_*.sql`. Apply via Supabase SQL Editor (paste + run) or `supabase db push` after `supabase login --token <pat>` and `supabase link --project-ref <ref>`. No test runner configured yet.

## Tech stack

- Next.js 16 App Router, Turbopack, React 19, TypeScript
- Tailwind v4 — palette + scale defined in `globals.css` `@theme` block, no `tailwind.config`
- Supabase: `@supabase/ssr` for SSR auth + cookies, `@supabase/supabase-js` for service-role
- shadcn-style primitives at `src/components/ui/` (Button uses CVA + radix Slot, Input/Textarea/Label/Card)
- Lucide React for icons
- Deployed to Vercel (push to `main` triggers deploy)

Required env vars (and Vercel project settings): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Local-only: `SEED_*` for the seed script.

## Authentication & multi-tenancy

The app is gated by Supabase Auth; tenancy is real (not just a UI cookie).

**Three Supabase clients** at `src/lib/supabase/`:
- `server.ts createClient()` — SSR client for Server Components / Actions / Route Handlers, reads + writes auth cookies via `next/headers`
- `client.ts createClient()` — browser client for Client Components
- `admin.ts createAdminClient()` — service-role, bypasses RLS, server-only (cross-tenant queries, scripts)

Every client is a **factory function** — never instantiated at module load (a top-level `createClient()` call breaks Vercel page-data collection if env vars aren't injected at that phase).

**`src/proxy.ts`** is the Next 16 routing middleware (NOT `middleware.ts`). It calls `updateSession()` from `src/lib/supabase/middleware.ts` on every request: refreshes the auth cookie, redirects unauthed users to `/login?next=<pathname>`, and bounces authed users away from `/login` and `/signup` to `/dashboard`. Static assets and `/fonts/` are excluded from the matcher.

**Tenant model.** `tenants` table keyed by slug; `memberships(user_id, tenant_slug, role)` links users to tenants with `owner | admin | member`. `invitations` carry an email + role + token; the `accept_invitation(token)` RPC validates and creates the membership. RLS uses the `is_tenant_member(slug)` and `tenant_role(slug)` helper functions defined in `002_foundation.sql` — every tenant-scoped table FKs to `tenants(slug)` and gates with these helpers.

**Tenant switching** still uses the `tenant=<slug>` cookie. Server Components call `getCurrentTenant()` from `src/lib/auth.ts`, which validates the cookie against the user's actual memberships and falls back to the first one. After login the action sets the cookie to the user's first membership.

**Auth helpers** in `src/lib/auth.ts`: `getCurrentUser()`, `requireUser()` (redirects), `getUserTenants()`, `getCurrentTenant()`. Use these instead of reading `auth.getUser()` directly.

## Route groups

```
src/app/
├── layout.tsx            ← minimal root: html/body, ThemeScript, fonts
├── page.tsx              ← redirects to /dashboard
├── proxy.ts              ← auth gate (lives at src/proxy.ts not repo root)
├── (auth)/               ← login, signup — own minimal layout, no sidebar
│   ├── login/
│   └── signup/
└── (app)/                ← all protected pages — sidebar + auth check
    ├── layout.tsx        ← runs requireUser(), getUserTenants(), renders sidebar
    ├── settings/
    ├── (overview)/       (dashboard, weekly-report)
    ├── (content)/        (content-vault)
    ├── (social)/         (engagement, platform-score, viral-trends, ai-content, post-history)
    ├── (growth)/         (leads, ads-tracker)
    └── (intelligence)/   (intel-feed, content-briefs, seo-tracker/*, competition)
```

Route groups don't appear in URLs. The `(app)` group exists so the auth pages don't inherit the sidebar.

## Data layer pattern

```
lib/types/[module].ts      → TypeScript interfaces
lib/data/mock-[module].ts  → Mock data, Record<string, T> keyed by tenant slug
lib/services/[module].ts   → Async functions returning Promise<T>
lib/actions/[module].ts    → Server Actions ("use server" at top)
```

Components call services, never mock data directly. Services that talk to Supabase use the **server client inside the function** (so RLS applies to the logged-in user). Cross-tenant aggregations (e.g. `cross-brand.ts`) use the admin client.

Most modules still use mock data. The `intel-feed` module is the first to be Supabase-backed (`competitors`, `intel_cards`, `content_briefs` tables, migration `001_intelligence_feed.sql`). Convert the rest by adding a migration + rewriting the service to query Supabase, keeping types and components unchanged.

## Theming

Light is the default (`ThemeScript` in root layout sets `class="dark"` only when `localStorage["pulse-theme"] === "dark"`, before first paint). Users opt into dark via Settings → Appearance.

The Gruve light palette and full token scale are defined in `globals.css` `@theme`. The `html.dark` block overrides every relevant token to dark equivalents — so utilities like `bg-card`, `text-gray-1100`, `bg-primary-50`, `border-white-200` are all theme-aware automatically.

**Dark mode keeps Gruve red as the brand color** (not purple). See `DARK-THEME.md` for the full dark palette spec and the rules for picking theme-aware classes.

**Two recurring footguns:**
1. `text-white` is *not* theme-aware (Tailwind built-in = literal `#ffffff`). Use `text-foreground` for body text on cards. `text-white` is correct only when the background is colored (maroon button, gradient pill, etc.).
2. `bg-white` is also literal. Use `bg-card` for theme-tracking surfaces.

## Sidebar navigation

Items in `lib/nav-config.ts` (typed). Icon names map to Lucide imports in `components/sidebar/SidebarNavItem.tsx` via `iconMap`. To add a nav item: edit nav-config and add the Lucide icon to the import + the iconMap.

## Design system

- **Light** — `GRUVE-DESIGN.md` is the canonical spec (maroon `#ad112c`, Satoshi @font-face, pill buttons, rounded-lg inputs, rounded-2xl cards, blue focus rings, no in-app gradients).
- **Dark** — `DARK-THEME.md` documents the dark palette, surface hierarchy, and conversion rules.
- **Logo** — `components/ui/Logo.tsx`. Bold italic; flat maroon in light, `bg-clip-text` red gradient in dark.
- **Fonts** — `@font-face` references `/public/fonts/Satoshi-{Regular,Medium,Bold,Black}.woff2`. Files aren't in the repo; falls back to system sans-serif until they're dropped in.

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
