# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Start dev server (localhost:3000)
pnpm build      # Production build (also runs TypeScript check)
pnpm lint       # ESLint
```

No test runner is configured yet. Vitest + React Testing Library planned.

## Architecture

### Multi-Tenancy (Cookie-Based)

Tenant switching uses a browser cookie (`tenant=gruve`). Server Components read `cookies()` to get the current tenant slug. The `TenantSwitcher` client component sets the cookie via `document.cookie` and calls `router.refresh()`.

No React Context for tenancy. This preserves Server Components for async data fetching. Every page that reads tenant-specific data follows this pattern:

```typescript
const cookieStore = await cookies();
const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
```

### Data Layer Pattern

```
lib/types/[module].ts      → TypeScript interfaces
lib/data/mock-[module].ts  → Mock data (Record<string, T> keyed by tenant slug)
lib/services/[module].ts   → Async functions returning Promise<T>
lib/actions/[module].ts    → Server Actions ("use server" at top)
```

Components call service functions, never import mock data directly. When Supabase connects, swap the service implementation. Components and types stay the same.

Mock data uses `Record<string, T>` keyed by `"gruve" | "sippy"`. Service functions accept `tenantSlug: string` and default to empty arrays/null for unknown slugs.

### Route Groups

- `(overview)` — Dashboard, Weekly report
- `(content)` — Content vault
- `(social)` — Engagement inbox, Platform score, Viral trends, AI content engine, Post history
- `(growth)` — Leads & outreach, Ads tracker
- `(intelligence)` — Intel feed, Content briefs, SEO tracker (+ sub-routes), Competition (legacy, being absorbed into intel feed)

Route groups are organizational only (parenthesized folders don't appear in URLs). `/` redirects to `/dashboard`.

### Intelligence Feed Module (newest)

The intelligence feed is the competitive intelligence layer. Key files:
- `lib/types/intelligence.ts` — Competitor, IntelCard, ContentBrief, MorningBriefItem, WeeklyDigest
- `lib/data/mock-intelligence.ts` — Mock competitor data for Gruve (Tix Africa, Nairabox, Sofar Sounds) and Sippy (Sky Lounge, Hard Rock, Drinks.ng)
- `lib/services/intelligence.ts` — getIntelFeed, getMorningBrief, getWeeklyDigest, getCompetitors
- `lib/actions/intelligence.ts` — Server Actions for form submission and content brief generation
- `components/intelligence/` — IntelCard (client component with "Steal This" button), MorningBriefing, WeeklyDigest

The intel feed page uses a 3-panel layout: sidebar (existing) + center feed + right weekly digest (hidden below lg breakpoint).

### Sidebar Navigation

Navigation items are defined in `lib/nav-config.ts` as typed data. Icons are mapped in `components/sidebar/SidebarNavItem.tsx` via an `iconMap` record. When adding a new nav item, add both the entry in nav-config.ts AND the Lucide icon import + map entry in SidebarNavItem.tsx.

## Tech Stack

- Next.js 16 (App Router, Server Components, Turbopack)
- Tailwind CSS v4 (CSS `@theme` in globals.css, no tailwind.config file)
- Inter font via next/font
- Lucide React for icons
- Supabase JS client installed but not connected (mock data layer for v1)
- Deployed to Vercel (push to main triggers deployment)

## Design System

- **Theme:** Dark mode only. Background `#0a0a0f`, cards `#1a1a24`, sidebar `#111118`
- **Accents:** Purple-to-pink gradient (`#7c3aed` → `#ec4899`)
- **Typography:** Inter — 36px/800 display, 24px/700 h1, 14px/600 h2 uppercase, 14px/400 body, 11px/500 caption
- **Spacing:** 4px base grid (4, 8, 12, 16, 24, 32px)
- **Colors:** All defined as CSS custom properties in globals.css `:root`, mapped to Tailwind via `@theme inline`
- **Badge:** Single `Badge` component with variant prop. Add new variants to the `variantStyles` record in `components/ui/Badge.tsx`
- **Interactions:** 150ms ease hover transitions, 2px purple focus ring, 1.5s skeleton pulse

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.

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
