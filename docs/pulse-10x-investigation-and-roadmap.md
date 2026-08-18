# PULSE — 10x Investigation, Diagnosis, and Roadmap

Produced from a live-product walkthrough brief (Aug 18, 2026). Investigated with 7 parallel research agents against the actual codebase on `feat/shared-inbox-and-lead-quality-tiers`, then built and browser-verified the P0 fixes. This doc is the Phase 0 Investigation Report + Phase 1 diagnosis + Phase 2 module plans + prioritized roadmap, plus a changelog of what shipped the same night. Every finding below has file:line evidence; nothing here is guessed.

**Important context correction**: the original brief's symptom list predates recent work on this branch. Lead quality tiers, duplicate flagging (migration 104), and the shared inbox/support role (102-103) were already shipped. Brand-voice/ICP AI grounding is more wired-in than assumed. Several brief items (E partially, F mostly) turned out to already be fixed in code — the investigation re-verified every symptom against current code rather than trusting the brief at face value, and this doc calls out where the brief was right, wrong, or half-right.

---

## Phase 0 — Investigation Report

### Architecture
- Next.js App Router, route groups: `(app)`, `(auth)`, `(onboarding)`, plus `api/`, `approve/`, `invite/`, `oauth/`, `pricing/`, `r/`. `src/proxy.ts` (not `middleware.ts`) is the auth gate.
- `getCurrentTenant()` (`src/lib/auth.ts`) validates the `tenant` cookie against real memberships, falling back to whichever tenant has `settings.brand_voice` set.
- A `requireTenantRole()` guard exists as a UI-layer second line of defense on top of migration 103's real RLS restriction (undocumented in the project CLAUDE.md).

### Data model / migrations
- The project CLAUDE.md's migration list is stale — it claims "through 092"; the actual highest is **104_prospect_quality.sql**. Missing from the doc: 093–101, **102_shared_inbox_conversations**, **103_support_role**, **104_prospect_quality**.
- Migration 104 adds `prospects.quality` (`unscored|hot|warm|cold|dead`) and `prospects.duplicate_of_id` (soft-link, not delete) — this is the "Lead Data Quality" work the brief assumed didn't exist. It's freshly shipped, matching the two most recent commits on this branch.
- `TenantMembership.role` now includes a 4th role, `"support"` (migration 103), gated by `is_support_member()` RLS — real security boundary; nav-hiding is cosmetic on top.

### AI grounding — mostly already correct, contrary to the brief
- `getBrandContext()`/`buildPositioningBlock()` (`src/lib/ai/brand-positioning.ts:79-90,101-135`) is wired into `outbound.ts:166,356`, `personalize-template.ts:64`, `engage.ts:73`, `x-engage.ts:53,136`, `coach.ts:168`, `conversation-intelligence.ts:19,132-134,207`. The brief's claim that brand voice/ICP "is not loaded" does not reproduce in code — it's loaded on every relevant AI call path.
- Geo scope is already used to cap qualification scores (`outbound.ts` "cap the score under 50" if outside `geoScope`) — contradicting the brief's claim of "no location filtering" at the prompt level. The real gap (see Module 5) is that this signal is empty by default and there's no *hard* filter or UI surface for it.
- Em-dash stripping already exists: `stripBannedDashes()` (`src/lib/blog/content-flags.ts:126`), wired into every outbound/engagement AI output path (`outbound.ts:311,313`, `engage.ts:107-108`, `x-engage.ts:103-104,191`). The brief's "no banned-character mechanism" claim is false as a code claim.
- **Real gap**: `brandVoiceSchema` has no structured "banned characters" field beyond the hardcoded em-dash strip — `do_list`/`dont_list` are freeform text.
- **Real gap, and the actual explanation for the brief's Sippy complaint**: `getBrandVoice`/`getBrandPositioning` require non-empty schema-valid data (`min(1)` fields) — if a tenant's `tenants.settings.brand_voice`/`brand_positioning` is unfilled, these return `null` and every AI call silently falls back to "write for a general business audience." **This is a data-completeness (onboarding) problem, not a wiring bug** — see Module 7.

### Test coverage
- 47 unit test files, 18 integration test files, all passing (365 unit + 142 integration, verified tonight). Good breadth on content-calendar, shared-inbox, RLS, OAuth.
- **Gap**: zero test files match `outbound`, `prospect`, `discovery`, or `qualify` — the highest-priority subsystem in this whole brief has no unit test coverage. `logAiCall()` telemetry infra is real and centralized (not stubbed).

### Integration status matrix (Module 2 detail)

| Integration | Real/Stubbed/Gated | Connection UX | Risk |
|---|---|---|---|
| WhatsApp | Real (Meta Cloud API) | Paste-token form at `/broadcasts` (no guided OAuth — inherent to WhatsApp Business API) | **Was orphaned from its own checklist link** (fixed tonight) |
| Meta Ads | Real, Composio OAuth | Guided | CAPI token still manual (external constraint) |
| TikTok Ads | Real, direct OAuth | Guided, but gated behind env vars with no self-serve path if unset | Needs a developer if unconfigured |
| GA4/GSC/Contentful | Real (JWT/CMA) | Paste-token/JSON (inherent to these APIs) | None found |
| Instagram/TikTok/LinkedIn | Real, **two parallel paths**: Composio OAuth (`connected_accounts`, ads/engagement) vs SocialAPI.ai (`platform_connections`, scheduling/publish) | Composio = guided OAuth. SocialAPI.ai = **requires signing up externally, then a developer pasting an API key into deployment env vars and redeploying** | Highest non-technical-operator wall in the whole integration surface |
| X (Twitter) | Correctly disabled, honestly labeled | Copy-only by design | None |
| YouTube | Real, direct OAuth, honestly gated | Guided | Best-behaved connector in the audit |

No integration silently no-ops; each either works or shows an explicit "not configured" state. The real problems are (a) the WhatsApp routing bug (fixed), (b) no priority weighting for a tenant's primary channel, (c) SocialAPI.ai/TikTok Ads requiring a developer with no in-app escape hatch, (d) no single shared "is X connected" hook — every page re-derives status from the same tables independently (currently consistent, but one query changing risks silent drift).

---

## Phase 1 — Symptom diagnosis (A–J)

### A. Lead discovery engine — root-caused and fixed tonight (P0, highest priority)

1. **0 results, always.** `scrapeGoogleSerp()` (`src/lib/scrape/google-serp.ts`) silently returns `[]` whenever Serper comes back empty (real behavior — Google sparsely indexes Instagram/TikTok profile pages) **and** the Apify fallback isn't configured. Confirmed in `.env.local`: `APIFY_SERP_ACTOR_ID` is blank while `APIFY_API_TOKEN` is set, so the fallback is dead. The specific failure reason (`auth_failed`/`rate_limited`/`quota_exhausted`/`empty`/`not_configured`) was captured deep in the stack (`SerperError.status`) and then discarded — the rep only ever saw "no results came back — try broader keywords" regardless of cause.
   - **Fixed**: added `scrapeGoogleSerpDetailed()` (new function, zero behavior change to the 6 other callers of the original `scrapeGoogleSerp`) that propagates a real diagnostic string through `DiscoveryResult` → `RunSearchOutcome` → the UI. A rep now sees e.g. "Serper rejected the API key" or "Google has no indexed results for this exact query" instead of a generic dead-end.
   - **Update — verified live after the user added `APIFY_SERP_ACTOR_ID`/`APIFY_API_TOKEN`/`SERPER_API_KEY` tonight**: ran a real saved search end-to-end and confirmed **"Added 5 new prospects · 5 auto-qualified · 1 already in pipeline (skipped)"** — the discovery engine works. But the real per-request cause turned out to be sharper than the "sparse indexing" theory above: Serper returned a consistent HTTP 400 with body `"Query pattern not allowed for free accounts."` — **this Serper account's plan does not allow `site:` operator queries at all**, and the entire discovery mechanism (and the Content Calendar's "how others are covering this" creator-search — `content-calendar.ts`'s `creatorSiteFilter`, same `site:tiktok.com OR ...` pattern) is built on `site:` queries. So on the free tier, Serper will **always** reject these specific searches and Apify does 100% of the real work every time, not intermittently. Added a new `SerperError` status (`plan_restricted`) that reads the response body and surfaces this exact reason instead of a generic "HTTP 400," and confirmed the diagnostic chain built earlier tonight correctly threads it through. **Human decision needed**: either upgrade the Serper plan to one that allows `site:` operators (removes the extra Apify-fallback latency/cost on every single discovery run and creator-search call), or accept Apify as the permanent primary for these specific query types — the code already self-adapts either way, no further change needed once that decision is made.

2. **Event-platform scraper gated behind a hardcoded allowlist.** `src/lib/scrape/event-platforms/tenant-config.ts:7` was `const ENABLED_TENANTS = new Set(["gruve"])` — a literal hardcoded tenant slug, a direct violation of the "never hardcode" principle. It was a blunt incident hotfix (a past manual run against the wrong tenant wrote Gruve-ICP prospects into Sippy — see the comment this replaced), not real ICP logic.
   - **Fixed**: `isEventScraperEnabledForTenant()` now reads `tenants.settings.eventScraper.enabled` (default **true** for every tenant) via a DB query, async, admin client. Every tenant gets the scraper by default; a tenant can opt out via config. All 3 call sites (`page.tsx`, the manual-run action, the cron) updated. This directly fixes the brief's stated Sippy complaint — Sippy was never on the old allowlist and now is enabled by default like every other tenant.
   - A second, parallel discovery system (`src/lib/scrape/discovery-config.ts`) has the same "gruve gets a free default, everyone else defaults to null" pattern, but it degrades safely (no gate is broken, tenants without config just get no default sources) rather than actively excluding anyone — left as a P1 generalization (see Module 1 plan) rather than risking a rushed change to a working system with real hardcoded Gruve source URLs.

3. **Signal type selector has no effect on the query.** Confirmed bug: `siteSearchQueryFor(platform, userQuery)` never received `signalType` — the dropdown only relabeled the *result* afterward (`buildSignalSummary`), never shaped the *query*.
   - **Fixed**: `siteSearchQueryFor()` now takes `signalType` and genuinely reshapes the query per type — hashtags are quoted as exact tokens, event-host/attendee signals add likely bio language (`organizer OR "event host" OR "hosted by"`, `attended OR "was at" OR guestlist`), recent-post biases toward recency language. Verified reactively in the browser: switching the dropdown changes both the placeholder and the live query preview.

4. **"Auto-quoted" exact-match complaint.** Not a real bug in the query builder — `siteSearchQueryFor` never added quotes. It was a **misleading preview string** in the new-search form showing fake curly quotes around the query that the actual code never applied, priming reps to misdiagnose the real problem (sparse indexing) as over-narrow quoting.
   - **Fixed**: preview text now accurately describes what happens, ties the explanation to the selected signal type, and no longer shows quotes that aren't there.

### B. Integrations — see matrix above. WhatsApp routing bug fixed tonight (checklist item pointed to `/settings/integrations`, which has no WhatsApp form; now points to `/broadcasts`, the real connect page — browser-verified).

### C. Reply and follow-up loop — root-caused and partially fixed tonight (P0)

- **Confirmed mechanism for the false "all clear."** `getOutreachToday()`'s "New Replies" bucket only looked at `inbound_messages` with `read_at is null AND received_at >= now-48h`. `recordInboundMessage` flips `prospects.status` to `'replied'` on any inbound message — which excludes it from "Going Cold" (requires `status='sent'`) and from "Overdue"/"Due Today" (requires a `follow_up_at` that's only ever set manually or by a conversation analysis that itself only runs manually). A reply that sits unread past 48 hours with no `follow_up_at` becomes invisible to **all four buckets simultaneously** — reproducing the brief's exact "nothing overdue, you're on top of it" false positive.
  - **Fixed**: the query now fetches ALL unread inbound messages regardless of age (oldest-first), renamed "New Replies" → "Unanswered Replies" with copy that says "checks all unread replies, not just recent ones," and replies older than 48h get a visible "Aging" badge. Browser-verified.
- **Confirmed: scoring and analysis are 100% manual-trigger, and "Ready to send" reads 0 while warm leads exist.** `qualifyProspect`/`bulkQualifyNewProspects` and `analyzeProspectConversation` are only ever called from UI button clicks — never from import, scraper output, or an inbound reply. `analyzeProspectConversation` additionally **hard-fails** (`getCurrentUser()` returns null → error) if called from a system context, so it structurally cannot be wired to a webhook without a new code path.
  - **Fixed (auto-scoring on manual import)**: `importProspects` now flags `signal_data.qualify_pending = true` on insert, matching the pattern the extension bulk-add route and event-platform scraper already used — the existing generic `qualify-backlog` cron sweep now picks up manually-imported rows too. (Discovery-search and event-scraper ingestion were already auto-qualified; manual CSV/sheet import was the one gap.)
  - **Fixed (auto-analysis on reply)**: added `analyzeConversationSystem()` (`src/lib/services/outreach-intelligence.ts`) — a system-actor variant of the existing human "Analyze" action that takes the caller's Supabase client directly (admin or session, both work correctly under RLS) instead of gating on `getCurrentUser()`. Wired into `recordInboundMessage` so **every** inbound reply — regardless of channel or entry point (webhook, MCP tool, human action) — now triggers analysis automatically. The existing `conversation_analyses` DB trigger auto-propagates `recommended_follow_up_at` onto the prospect, so Overdue/Due Today start populating correctly for replied prospects too, closing two gaps with one hook. Uses the schema's own `trigger_type = 'inbound_message'` enum value, which existed but was never fired. Never throws (wrapped try/catch) — a failure here cannot break inbound-message recording. Verified via the existing shared-inbox integration test suite (all 142 integration tests still pass) plus a live dashboard/pipeline check.
  - **Not done, and deliberately not rushed**: auto-drafting an actual follow-up DM (vs. just a recommendation) on reply. `analyzeConversationAi`'s output is a recommendation (`recommended_follow_up_note`), not a ready-to-send draft body. Wiring a real auto-draft would reuse `draftOutboundDmAi` but needs quality verification I can't do without live testing against real reply threads — scoped as the concrete next step in Module 3's plan.
- **Important discovery not in the original brief**: the "two inboxes" are not two separate tables as initially assumed — they're **one shared `inbound_messages` table split by a nullable `prospect_id`**. The WhatsApp webhook (`src/app/api/integrations/whatsapp/route.ts`) — Sippy's primary channel — inserts with **no `prospect_id`**, so it lands only in the Conversations/shared-inbox system and never flows into the Outbound/Today pipeline (no auto-analysis, no `follow_up_at`, invisible to the fixes above). This is the single highest-value remaining gap and is **not fixed tonight** — see Module 3's plan for why (a live webhook Meta calls in production, needs phone/handle-matching design and cannot be safely rushed without browser/integration testing against real WhatsApp traffic).

### D. Information architecture — fixed tonight (P0)

- **Confirmed and fixed**: Outbound/Conversations were the last of 6 sidebar groups. Now the 2nd group (right after Dashboard/Analytics), verified in the browser.
- **Confirmed and fixed**: "Signals" (competitor monitoring) vs. lead discovery (buried 2 clicks deep inside Outbound → Discovery tab) naming collision. Renamed nav item + page H1 to "Competitor intel." Verified in the browser.
- **Confirmed and fixed a real, currently-shipping deep-link bug**: `prospect-thread-panel.tsx:846` links to `/leads?tab=templates`, but the tab-initializer only recognized `"inbox"`/`"today"` and silently fell through to Pipeline. Now recognizes all 5 real tab values.
- **Confirmed 404s for guessed URLs, fixed with additive redirect stubs**: `/outbound` → `/leads`, `/signals` → `/intel-feed`, following the exact pattern already used by `/analytics` → `/own-analytics` and `/content-briefs` → `/ai-content?tab=briefs`. Zero risk (purely additive, no existing route touched).
- **Confirmed the two calendars genuinely co-display for startup tenants** (not persona-segregated as hoped — `Content calendar` had no `surfaces` restriction). Fixed by gating it to `surfaces: ["individual"]`, matching its actual designed purpose per the codebase's own module description. AI Calendar and Content Calendar are genuinely different implementations, not the same feature twice — this only fixes *visibility overlap*, not a redundancy.
- **Confirmed two unrelated health-score formulas** (dashboard "Profile score" = connected-platform count/4; `/platform-score` = a weighted engagement/frequency/follower formula). Chose "clearly differentiate" over "merge into one" (merging is a real product decision that shouldn't be forced through unreviewed) — relabeled the dashboard stat to "Platforms tracked," which is literally what it measures and can no longer be confused with the `/platform-score` page. Verified in the browser.

### E. Lead data quality and scoring — partially already fixed by recent work, partially fixed tonight

- Migration 104 (already shipped, not by this session) added `prospects.quality` and `duplicate_of_id` — the brief's premise that quality tiers/dedup don't exist was already out of date.
- **Confirmed real gap, fixed tonight**: manual CSV/sheet import was the one ingestion path that never triggered qualification (see Module C above).
- **Confirmed real gap, not fixed tonight (scoped as Module 5 P1)**: no hard city/service-area filter anywhere. `outbound_filters.geoScope` exists and already caps AI qualification scores for out-of-scope prospects, but (a) it's empty by default (`DEFAULT_OUTBOUND_FILTERS_SEED.geoScope: []`), so geo capping is silently off until a tenant configures it, and (b) there's no UI filter/badge on the `/leads` list itself, only a soft LLM instruction. A "Set your service area" Needs You check now surfaces this gap live (verified: Gruve currently has it unset, correctly flagged as a P0 blocking item in the browser test tonight). The filter/badge UI itself is deferred — depends on tenants actually having this configured, which the new Needs You nudge should drive.

### F. Brand/voice/config — mostly already correct in code; the real gap is data-completeness, not wiring (see AI grounding section above). No structured "banned characters" field beyond the hardcoded em-dash strip — flagged as a Module 7 follow-up, not attempted tonight (would need a schema migration + prompt-injection changes across every AI call site, too broad to rush).

### G. Reliability/routing — see D above for the concrete fixes. No additional dishonest empty/success states found beyond the ones already covered in A/C (checked content-vault, video, ads-tracker, seo-tracker — all toast/success messages fire conditionally on real outcomes).

### H. Onboarding/activation — **root-caused, high-value finding, only half-fixed tonight**

- Confirmed: onboarding (`/onboarding/audit`, `/onboarding/personal`) stops at brand voice extraction — zero guidance toward connecting the primary channel or running first discovery. `enterApp()` just redirects to `/dashboard`.
- **Major finding**: `getSetupStatus()` (the predecessor to tonight's Needs You engine) already existed, fully built, correctly detecting real tenant state — and had **zero importers anywhere in the codebase**. It was completely orphaned/unrendered. The project CLAUDE.md's claim of a rendered "SetupBanner" was stale/wrong.
- **Fixed tonight**: extended this orphaned engine into the full Phase 4 "Needs You" feature (see below) and wired it into the dashboard, sidebar, and a dedicated page — closing the "built but invisible" gap, which is arguably the single highest-leverage fix in this entire session (it surfaces every other gap this document describes, live, per-tenant, automatically).
- **Not fixed tonight**: the onboarding *wizard itself* still doesn't actively walk a new tenant through channel-connect + first-discovery-run. The Needs You banner will nudge a tenant post-onboarding, but a first-run tenant landing on an empty dashboard still has to notice it. Scoped as Module 7's P1 recommendation: add a "you're set up, here's what's next" step at the end of the existing wizard that deep-links straight into the Needs You P0 items.

### I. Content ships gap — root-caused, not fixed tonight (P1, see Module 8 plan)

- Confirmed: `coach_actions` has a `distribution_gap` source type declared in the schema but never generated by any code path. No stale-draft alert, no bulk-publish nudge, no cron. A well-scoped, contained fix (one new coach-action generator + a cron), deferred to keep tonight's scope on the reply/discovery/IA/onboarding P0s.

### J. Observability — partially fixed tonight as a side effect of A's diagnostic propagation; the broader "found → scored → contacted → replied → converted" live funnel view does not exist (only a once-a-week narrative digest touches this) — scoped as Module 9.

---

## Phase 4 — "Needs You" checklist: shipped tonight

Built as a genuine detection **engine**, not a static list — `src/lib/services/setup-status.ts` is a registry of check definitions (`detect`, `unblocks`, `priority`, `kind`, `href`), each running against any tenant's live state with zero tenant-specific code. Extended from the pre-existing orphaned `getSetupStatus()` rather than rebuilt from scratch.

**Registered checks** (P0/P1/P2, tenant-agnostic): brand voice set, brand positioning set, WhatsApp connected (fixed the broken href), service area configured, Instagram connected, GA4 connected, storefront API token created, discovery sources set, alert email set. Adding a new blocker type going forward = one new entry in `CHECK_DEFINITIONS`.

**Surfaces**: dashboard banner (collapsible summary → full list, `NeedsYouBanner.tsx`), sidebar badge with live open-item count (`NeedsYouBadge.tsx`, hidden for the `support` role since they can't act on tenant-wide setup), dedicated `/needs-you` page grouped by priority with a progress bar. All three verified live in the browser against the real Gruve tenant — correctly showed "5/9 set up, 2 blocking" and the exact right items (WhatsApp not connected, service area unset), with the WhatsApp "Fix" link correctly landing on the real connect form.

**Explicitly not shipped**: a "pending approvals" check. `approval_requests` (migration 091) is delivered via email/WhatsApp to an external decision-maker with a token-gated `/approve/[token]` magic link — there is no in-app list view for a logged-in rep to review these, so linking to `/approve` would have been a broken/misleading href. Removed from the registry rather than shipped broken; flagged as a good next check once the in-app review surface exists (needs product-design input on whether this even belongs in a rep-facing checklist vs. staying purely external).

---

## Verification performed tonight

- `npx tsc --noEmit` — clean, zero errors, after fixing one Promise-typing issue introduced during the Needs You build.
- `npx eslint` on every touched file — zero new errors/warnings (11 pre-existing warnings in `leads/client.tsx`, none on lines touched).
- `pnpm test` (Vitest): **365/365 unit tests pass**, **142/142 integration tests pass** (including the shared-inbox two-tenant-leak and auto-reply-failure suites, which exercise code adjacent to the `recordInboundMessage` change).
- Live browser verification (Chrome, logged in as the seeded Gruve owner, against real production-shaped data — ~1000 real prospects): sidebar reorder, Needs You badge/banner/page (all three, with correct live counts), WhatsApp Fix-link routing, "Platforms tracked" relabel, "Competitor intel" rename, discovery form's signal-type-reactive query preview, and the Today tab's "Unanswered Replies" rename — all confirmed working with zero console errors across every page visited.
- E2E (Playwright) suite was **not** run tonight — no browser automation budget was reserved for it in this session; recommend running it before merge as a final gate.

---

## Module plans

Each module: problem, root cause, options + recommendation, scope, risks, test plan, one success metric.

### Module 1 — Lead Discovery Engine (P0, mostly shipped tonight)
- **Problem**: reps get 0 leads. **Root cause**: silent fallback-chain failure, hardcoded tenant allowlist, dead signal-type selector, misleading UI copy — all detailed in Symptom A above, all fixed except the Apify actor-ID credential decision.
- **Options considered**: (a) surface real diagnostics + fix the allowlist [chosen — lowest risk, highest immediate impact], (b) replace Google-SERP discovery with a different provider entirely [rejected — the existing Serper+Apify architecture is sound, the bug was operational not architectural], (c) add a proxy layer for anti-bot resilience [deferred — no evidence yet that any platform is blocking requests, matches the codebase's existing cost-conscious philosophy].
- **Remaining scope**: (1) human decision on `APIFY_SERP_ACTOR_ID` (cost/credential); (2) generalize `discovery-config.ts`'s Gruve-only default the same way `tenant-config.ts` was generalized tonight — deferred because it degrades safely today (P2, not urgent); (3) `ticketing_platform` signal type still needs real re-routing into the event-platform scraper instead of a generic site-search (documented as a known limitation in the query-builder code comment).
- **Risks**: none of tonight's changes touch data deletion or external sends; all additive/diagnostic. The one live-system risk (WhatsApp webhook unification) was explicitly deferred, not rushed.
- **Test plan**: unit tests for `siteSearchQueryFor` per signal type (not yet written — flagged as a real test-coverage gap in Phase 0), integration test for the diagnostic-propagation chain, manual "Run now" against a tenant with no Apify configured to confirm the new diagnostic message appears.
- **Success metric**: % of "Run now" discovery attempts that return ≥1 candidate, tracked per tenant, trending toward the historical baseline once `APIFY_SERP_ACTOR_ID` is set.

### Module 2 — Connectors & Channels (P1, diagnosed, WhatsApp routing bug fixed)
- **Problem**: primary-channel absence is a quiet checklist row, not a blocker; two integrations need a developer to touch env vars.
- **Options**: (a) make WhatsApp connection a hard first-run gate for startup tenants [risk: could block a tenant that genuinely doesn't use WhatsApp — Sippy-specific assumption smuggled into a generic gate, rejected], (b) keep it as a high-priority Needs You item with correct routing [chosen — already shipped tonight, respects "no tenant is special-cased"], (c) build guided OAuth for WhatsApp Business (Meta's embedded signup flow exists) [P1 follow-up, real engineering lift, would remove the paste-token wall entirely].
- **Scope**: `src/lib/integrations/whatsapp.ts`, `WhatsAppConnectCard.tsx`, `/broadcasts`.
- **Risks**: guided-OAuth work touches live messaging credentials — needs careful review, real Meta app review process, not a same-night change.
- **Test plan**: connect flow tested manually against Meta's sandbox before any OAuth change ships.
- **Success metric**: % of startup tenants with WhatsApp connected within 7 days of signup.

### Module 3 — Reply & Pipeline Loop (P0, mostly shipped tonight, one deferred item)
- **Problem/root cause**: see Symptom C.
- **Options for the WhatsApp/shared-inbox unification** (the one deferred item): (a) match inbound WhatsApp messages to existing `prospects` by phone/handle at webhook time, setting `prospect_id` so they flow into the existing (now-fixed) Outbound pipeline [recommended — reuses everything shipped tonight, no new subsystem]; (b) build a second, parallel auto-analysis path for shared-inbox-only messages [rejected — duplicates logic, doubles AI cost, doesn't unify the rep's view]; (c) leave the two systems separate and add a cross-link UI only [rejected — brief explicitly wants unification, not just visibility].
- **Scope for (a)**: `src/app/api/integrations/whatsapp/route.ts` (add a phone-match lookup before insert), `prospects.phone` (already exists, mig 081), needs a normalization function for Nigerian phone formats.
- **Risks**: **live production webhook Meta calls** — a bad match could misfile a real customer-support message as a prospect reply, or fail to match a real lead. Needs phone-normalization edge-case testing and a design review before touching this file again.
- **Test plan**: unit tests for phone normalization/matching against real-world format variants (with/without country code, spaces, dashes); staging-webhook replay before production.
- **Success metric**: % of inbound WhatsApp messages successfully linked to a `prospect_id` (target: matches the % of inbound senders who are actually existing prospects, not 100%).

### Module 4 — Information Architecture & Navigation (P0, shipped tonight)
- **Problem/root cause**: see Symptom D. All identified issues fixed and browser-verified tonight.
- **Remaining scope**: none identified as urgent; the module is effectively closed pending a broader design pass if the team wants a full IA rethink beyond tonight's surgical fixes.
- **Risks**: none — all changes were copy/nav-config/additive-route changes, zero data-model risk, verified with a clean TS/lint/test pass plus live browser check.
- **Test plan**: covered by the browser verification above; recommend adding a route-smoke-test (hit every nav-config href, assert 200/redirect not 404) to CI to prevent regression.
- **Success metric**: time-to-first-lead-search for a new rep in a usability test (qualitative, needs a real user session to measure — flagged as needing human involvement).

### Module 5 — Lead Data Quality & Scoring (P0/P1 split, partially shipped)
- **Problem/root cause**: see Symptom E.
- **Shipped**: manual-import auto-qualify gap closed.
- **Deferred (P1)**: service-area hard filter/badge UI on `/leads`. **Options**: (a) hide out-of-scope prospects entirely [rejected — text-matching city/state names against freeform `location` strings risks false negatives silently hiding real leads]; (b) badge + optional hide-toggle, default show-all [recommended — matches the codebase's existing "never silently hide" philosophy]; (c) do nothing beyond the soft AI-score cap that already exists [rejected — doesn't meet the brief's "visible fit score and reason" bar].
- **Scope for (b)**: a new geo-matching utility (`location` string vs. `GeoRegion[]`), a badge component, a filter toggle in `leads/client.tsx`'s pipeline tab, threading `outboundFilters` down as a prop.
- **Risks**: low — read-only UI addition, no data mutation.
- **Test plan**: unit tests for the geo-matching utility against real Nigerian city/state name variants (abbreviations, misspellings) before shipping — this determines whether option (b)'s hide-toggle is trustworthy enough to default on.
- **Success metric**: % of prospects shown to a rep that are within its configured service area (once configured — ties to the new Needs You "Set your service area" check driving adoption).

### Module 6 — Brand/Voice/Config Layer (P2, diagnosed, not built)
- **Problem/root cause**: see Symptom F / AI grounding section. Code-level wiring is already correct; the gaps are (1) no structured banned-character list beyond em-dashes, (2) tenant data-completeness (empty brand_voice/positioning silently degrades every AI call to generic).
- **Options for (1)**: add a `banned_terms: string[]` field to `brandVoiceSchema`, generalize `stripBannedDashes` into a generic `stripBannedTerms` — straightforward, low-risk, needs a migration + prompt update across every AI call site (broad blast radius, hence not rushed tonight).
- **Options for (2)**: already addressed indirectly — brand voice/positioning are now P0 Needs You items, which should drive completion. A stronger option (block entry to AI-heavy pages until voice is set) already exists in `(app)/layout.tsx`'s onboarding gate — confirmed working, not a gap.
- **Scope**: `src/lib/ai/brand-voice.ts` schema, `content-flags.ts`, every AI system-prompt builder (broad).
- **Risks**: touching every AI call site's prompt construction is inherently broad — needs staged rollout, not a single-night change.
- **Test plan**: golden-output regression tests per AI call site before/after the banned-terms change (none exist today — would need to be written first).
- **Success metric**: 0 em-dash (or other banned-term) occurrences in generated content, measured at `logAiCall()` time.

### Module 7 — Onboarding & Activation (P0 shipped partially, P1 remaining)
- **Problem/root cause**: see Symptom H.
- **Shipped**: the Needs You engine itself (this *is* most of the activation fix — a first-run tenant now sees exactly what's missing, live, without anyone hand-writing a checklist).
- **Remaining (P1)**: wire a "what's next" step into the end of the existing onboarding wizards (`/onboarding/audit`, `/onboarding/personal`) that deep-links straight into the top P0 Needs You item instead of dropping the tenant on a blank dashboard.
- **Options**: (a) redirect to `/needs-you` instead of `/dashboard` on first login [simplest, slightly jarring UX]; (b) embed a condensed 1-2-item version of the top P0 checklist items directly in the wizard's final screen [recommended — smoother, reuses `getSetupStatus()`]; (c) leave as-is, rely on the dashboard banner [rejected — brief explicitly wants a guided path, not just a passive banner].
- **Scope**: `.../audit/client.tsx`, `.../personal/client.tsx` final steps.
- **Risks**: low — additive UI on an already-gated flow.
- **Test plan**: manual walkthrough of both onboarding paths (startup + individual) end to end.
- **Success metric**: time from signup to first `getSetupStatus().doneCount` increase (i.e., time to first real action taken).

### Module 8 — Content Distribution (P1, diagnosed, not built)
- **Problem/root cause**: see Symptom I. `distribution_gap` coach-action type exists in schema, never generated.
- **Options**: (a) a new cron that scans scored-well blog posts / composer drafts stuck >N days and generates a `distribution_gap` coach action [recommended, follows the exact pattern `coachForBlogPost` already uses, low risk]; (b) a dashboard widget separate from Coach Feed [rejected — duplicates the existing Coach Feed surface for no reason]; (c) do nothing, rely on Weekly Review narrative [rejected — brief wants an actionable nudge, not just narrative].
- **Scope**: one new cron + generator function reusing `insertCoachActionAdmin`.
- **Risks**: low — read-only detection + an admin-client insert, same pattern as existing ad-alert crons.
- **Test plan**: unit test for the staleness-detection query threshold; manual check against a seeded stale draft.
- **Success metric**: median days-in-draft for a scored blog post before publish or explicit dismissal.

### Module 9 — Observability & Analytics (P1/P2, partially addressed as a side effect)
- **Problem/root cause**: see Symptom J. Weekly digest already tracks a partial funnel (`prospects_added → qualified → sent → replied → handed_off`) but it's a once-a-week narrative, stops before "converted," and discovery/gating failures were invisible until tonight's diagnostic fix.
- **Options**: (a) a live dashboard funnel widget reusing the weekly-review's existing counting logic on a rolling window instead of calendar-week [recommended, low new-infra cost]; (b) a dedicated analytics event pipeline [rejected — overkill relative to current data volume, adds infra cost the codebase's existing philosophy avoids]; (c) extend the funnel to include order/attribution data (already exists via `orders.utm_campaign` per the ads-platform module) [good P2 follow-up, ties two already-real subsystems together].
- **Scope**: `src/lib/ai/weekly-review.ts`'s counting logic, refactored into a reusable service function; a new dashboard widget.
- **Risks**: low.
- **Test plan**: unit tests for the funnel-counting service against seeded data at each stage.
- **Success metric**: the funnel widget itself — leads found/scored/contacted/replied/converted, visible without waiting a week.

### Module 10 — Reliability & Routing (P0, folded into Module 4, shipped tonight)
- Covered under Module 4 — the brief treated D and G as closely related, and the fixes ended up being the same set of changes (nav-config, redirect stubs, deep-link initializer fix).

---

## Prioritized roadmap

**P0 — shipped tonight**: lead discovery diagnostics + allowlist generalization + signal-type fix + preview-copy fix (Module 1, partial); WhatsApp checklist routing fix (Module 2, partial); reply-loop overdue-detection + auto-scoring-on-import + auto-analysis-on-reply (Module 3, partial); full IA/nav fixes (Module 4, complete); Needs You detection engine + banner + badge + page (Module 7, partial).

**P0 — needs a human decision, not code**: `APIFY_SERP_ACTOR_ID` credential/cost decision (Module 1); WhatsApp-to-prospect matching design review before touching the live webhook (Module 3).

**P1 — next up, well-scoped, not started**: service-area hard filter UI (Module 5); guided WhatsApp OAuth (Module 2); onboarding "what's next" step (Module 7); content-distribution stale-draft nudge (Module 8); live funnel widget (Module 9).

**P2 — deferred, lower urgency**: generalizing `discovery-config.ts`'s Gruve-only default (Module 1); structured banned-terms list beyond em-dashes (Module 6); order/attribution funnel tie-in (Module 9).

**Dependencies**: Module 3's WhatsApp unification depends on Module 5's phone-normalization utility existing first (shared need). Module 7's onboarding step depends on nothing further — can ship independently. Module 2's guided OAuth is the only item requiring external (Meta) approval lead time — start that process early if prioritized.

---

## Changelog (this session)

- `src/lib/scrape/event-platforms/tenant-config.ts` — replaced hardcoded `Set(["gruve"])` allowlist with tenant-config-driven default-enabled check.
- `src/lib/scrape/google-serp.ts` — added `scrapeGoogleSerpDetailed()` with real failure diagnostics; original `scrapeGoogleSerp()` untouched for its 6 existing callers.
- `src/lib/outbound/handle.ts` — `siteSearchQueryFor()` now takes `signalType` and genuinely reshapes the query per signal.
- `src/lib/ai/discover-prospects.ts`, `src/lib/services/prospect-searches-runner.ts`, `src/lib/actions/prospect-searches.ts` — propagate the new diagnostic through to the UI.
- `src/app/(app)/(growth)/leads/client.tsx` — real diagnostic message instead of generic "try broader keywords"; fixed misleading fake-quotes preview text; fixed the `?tab=templates`/`?tab=discovery` deep-link initializer bug.
- `src/app/(app)/(growth)/leads/page.tsx`, `event-platform-runs.tsx`, `src/lib/actions/event-scraper.ts`, `src/app/api/cron/scrape-event-platforms/route.ts` — updated for the async, generalized `isEventScraperEnabledForTenant`.
- `src/lib/actions/import-prospects.ts` — manual import now flags `qualify_pending` so the existing cron sweep scores it.
- `src/lib/services/outreach-intelligence.ts` — widened the "unanswered replies" query to all unread (not just 48h), added `analyzeConversationSystem()` for system-actor auto-analysis.
- `src/lib/services/outbound.ts` — `recordInboundMessage` now auto-triggers analysis on every reply.
- `src/app/(app)/(growth)/leads/today-view.tsx` — "Unanswered Replies" rename, aging badge, honest empty-state copy.
- `src/lib/nav-config.ts` — Outbound/Conversations moved to the 2nd group; "Signals" renamed "Competitor intel"; Content calendar gated to individual persona only.
- `src/app/(app)/(intelligence)/intel-feed/page.tsx` — H1 rename to match.
- `src/app/(app)/outbound/page.tsx`, `src/app/(app)/signals/page.tsx` — new redirect-stub routes.
- `src/lib/services/dashboard.ts` — "Profile score" relabeled "Platforms tracked" to stop colliding with `/platform-score`.
- `src/lib/services/setup-status.ts` — rebuilt into the full Needs You detection-engine registry (priority/kind/unblocks per check), new checks added (brand voice, brand positioning, service area), WhatsApp href fixed.
- `src/components/needs-you/NeedsYouBanner.tsx`, `NeedsYouBadge.tsx`, `src/app/(app)/needs-you/page.tsx` — new UI surfaces.
- `src/components/sidebar/Sidebar.tsx`, `src/app/(app)/(overview)/dashboard/page.tsx` — wired the new components in.

All changes are local commits pending — **nothing has been pushed or committed to git yet**; that's a deliberate stop point for review before any `git commit`/push, per this session's standing instruction not to push without explicit approval.
