# PULSE — Gruve Marketing OS

Multi-tenant marketing dashboard for Gruve, Sippy, and future startups.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Server Components)
- **Styling:** Tailwind CSS v4 (CSS @theme in globals.css, no config file)
- **Font:** Inter via next/font
- **Icons:** Lucide React
- **Database:** Supabase (deferred — using typed mock data layer for v1)
- **Deploy:** Vercel

## Architecture

### Multi-Tenancy (Cookie-Based)

Tenant switching uses a browser cookie (`tenant=gruve`). Server Components read `cookies()` to get the current tenant slug. The `TenantSwitcher` client component sets the cookie via `document.cookie` and calls `router.refresh()`.

No React Context for tenancy. This preserves Server Components for async data fetching.

### Data Layer Pattern

```
lib/types/[module].ts    → TypeScript interfaces
lib/data/mock-[module].ts → Mock data matching interfaces
lib/services/[module].ts  → Async functions returning Promise<T>
```

Components call service functions, never import mock data directly. When Supabase connects, swap the service implementation — components and types stay the same.

### Component Hierarchy

- `Sidebar > SidebarNav > SidebarNavGroup > SidebarNavItem` + `TenantSwitcher`
- `Badge` — single component with variant prop (gradient, active, urgent, overdue, etc.)
- Dashboard components: `StatCard`, `PlatformBreakdown`, `PulseSuggestions`

### Routing

- `/` redirects to `/dashboard`
- Route groups: `(overview)`, `(social)`, `(growth)`, `(discovery)`
- Module pages are stubs until implemented

## Design System

- **Theme:** Dark (#0a0a0f background), purple-to-pink gradients
- **Typography:** Inter — 36px/800 display, 24px/700 h1, 14px/600 h2 uppercase, 14px/400 body
- **Spacing:** 4px base grid
- **Colors:** See globals.css @theme block
- **Interactions:** 150ms ease hover, 2px purple focus ring, 1.5s skeleton pulse

## Testing

- Vitest + React Testing Library for component/service tests
- Playwright for E2E (dashboard golden path, tenant switching)

## Commands

```bash
npm run dev     # Start dev server
npm run build   # Production build
npm run lint    # ESLint
```

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
