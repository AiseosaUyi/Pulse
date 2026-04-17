# Engineering Plan: Competitor → Content Brief Generator (Feature 2)

**Status:** DRAFT — under /plan-eng-review
**Branch:** main
**Author:** aise
**Date:** 2026-04-17
**Scope:** Feature 2 only. Own-analytics (F1) and viral-spotting (F3) split into separate follow-up plans.

## Goal

Turn the week's `intel_cards` into on-brand content briefs that Priye can edit and Olamide can post. This is the wedge: "the thing that makes Abas say I can't work without PULSE" (per 2026-04-15 design doc).

Total net-new infra spend: $0. AI spend: **$0.50–2 / month** (5–10 briefs/week × 2 tenants).

## NOT in scope

| Deferred item | Why | Tracked where |
|---|---|---|
| Own-content analytics (CSV + screenshot intake for Gruve/Sippy posts) | Own accounts already give free access via Business Suite exports; no urgent blocker | Future plan: `docs/plan-own-analytics.md` |
| Viral spotting (cross-brand surfacing, TikTok Creative Center scrape, hashtag scout) | Depends on brief generator being validated first; otherwise viral ideas have nowhere useful to go | Future plan: `docs/plan-viral-spotting.md` |
| Brand-voice inference from existing posts | Ambitious quality-of-life feature; manual voice doc is the v1 baseline | `TODOS.md` addition |
| Weekly email digest of briefs | Ship the in-app UX first; email is a distribution channel, not the feature | `TODOS.md` addition |

## What already exists (plan reuses, does not rebuild)

| Existing asset | How plan reuses it |
|---|---|
| `intel_cards` table + RLS + seed data | Read input to brief generator |
| `content_briefs` table + RLS | Write output to it (add 3 columns via migration 012) |
| `tenants.settings jsonb` column | Store `brand_voice` under existing column — no ALTER TABLE |
| `src/lib/supabase/server.ts createClient()` | All service/action DB access |
| `src/lib/services/intelligence.ts` getIntelFeed() | Input to pattern grouping |
| Vitest + RLS integration test pattern (`tests/integration/rls.test.ts`) | Template for new tests |

---

## Architecture

```
Sunday 23:00 UTC (Vercel Cron)
        │
        ▼
┌──────────────────────────────────────────────────┐
│ /api/cron/generate-briefs route handler          │
│  1. Auth via CRON_SECRET                         │
│  2. For each tenant:                             │
│     a. loadIntelCardsLastWeek()                  │
│     b. groupPatterns()  [deterministic, no AI]   │
│     c. For each top-3 pattern cluster:           │
│        - hash(tenant, pattern, week_of)          │
│        - skip if brief already exists (idempotent)│
│        - generateBrief()  [AI Gateway call]      │
│        - insert into content_briefs              │
└──────────────────────────────────────────────────┘
        │                        ▲
        ▼                        │ on-demand path
┌──────────────────┐    ┌────────────────────────┐
│ content_briefs   │    │ POST /content-briefs/  │
│ (RLS, tenant)    │    │   generate-from-card   │
└──────────────────┘    │ (intel card → brief)   │
        ▲               └────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────┐
│ /content-briefs page (Priye edits/approves)      │
│  - list (status=draft|approved|published)        │
│  - BriefCard (read)                              │
│  - BriefEditor (edit draft, mark approved)       │
└──────────────────────────────────────────────────┘
```

**Boring-by-default:** all AI calls through Vercel AI Gateway (unified retry + cost tracking). No direct Anthropic SDK. All DB access through existing `createClient()` server factory. All new files follow existing naming/pattern (`types → services → actions → components → pages`).

---

## Migration 012: content_briefs metadata + brand_voice convention

```sql
-- brand_voice lives in tenants.settings jsonb (no ALTER TABLE needed)
-- Convention:
--   tenants.settings.brand_voice = {
--     tone: string,
--     audience: string,
--     do_list: string[],
--     dont_list: string[],
--     example_posts: string[]  // 2-3 actual captions
--   }

-- Extend content_briefs with generator metadata
alter table content_briefs
  add column if not exists triggered_by_type text
    not null default 'intel_card'
    check (triggered_by_type in ('intel_card','manual')),
  add column if not exists pattern_hash text,           -- nullable; used for cron idempotency
  add column if not exists generator_model text,        -- e.g. 'anthropic/claude-sonnet-4.6'
  add column if not exists generator_cost_usd numeric(8,4) not null default 0,
  add column if not exists dismissed_at timestamptz,    -- soft-delete timestamp
  add column if not exists dismissed_reason text;       -- optional "why" for prompt tuning

-- Extend status check to include 'approved' and 'dismissed' (was: draft, published)
alter table content_briefs drop constraint if exists content_briefs_status_check;
alter table content_briefs add constraint content_briefs_status_check
  check (status in ('draft','approved','published','dismissed'));

create unique index if not exists uq_content_briefs_tenant_pattern_week
  on content_briefs(tenant_id, pattern_hash)
  where pattern_hash is not null;
```

**Note on `triggered_by` FK:** existing schema has `triggered_by uuid references intel_cards(id) on delete set null`. This plan keeps that FK. For `triggered_by_type='manual'`, `triggered_by` is null. No FK drop, no split columns. (Decision: single nullable FK + discriminator is cleaner than split FKs at this scale.)

**Note on `trend_scout` trigger source:** deferred to F3 plan. When F3 lands, extend the check constraint to allow `'trend_scout'` and either add a second nullable FK column or drop the intel_cards FK. Not this plan's problem.

---

## File diff

**New files (13):**
```
src/lib/ai/gateway.ts                           # AI Gateway wrapper, getModelId(purpose), logAiCall()
src/lib/ai/brand-voice.ts                       # zod schema → z.infer type + getBrandVoice()
src/lib/ai/group-patterns.ts                    # deterministic clustering of intel_cards
src/lib/ai/generate-brief.ts                    # prompt construction + cached LLM call
src/lib/util/week-of.ts                         # startOfWeek(date, 'saturday') pure helper
src/lib/services/briefs.ts                      # list (with JOIN on intel_cards for competitor_name), getById
src/lib/actions/briefs.ts                       # generateFromCard, updateStatus
src/app/api/cron/generate-briefs/route.ts       # weekly job (Vercel Cron)
src/app/(app)/(intelligence)/content-briefs/
  client.tsx                                    # edit + approve
src/components/briefs/BriefCard.tsx
src/components/briefs/BriefEditor.tsx
src/app/(app)/settings/brand-voice/page.tsx
src/components/briefs/BrandVoiceEditor.tsx
```

**Modified files (3):**
```
src/app/(app)/(intelligence)/content-briefs/page.tsx   # currently mock; switch to services/briefs.ts
src/lib/types/intelligence.ts                          # ContentBriefStatus enum, add triggered_by_type
vercel.json                                            # add cron entry
```

**New infra files (Playwright, from review 3.5):**
```
playwright.config.ts
tests/e2e/content-briefs.spec.ts
.github/workflows/e2e.yml                       # CI wiring (optional if using Vercel's test step)
```

**Total: 19 files.** Still under the Step-0 soft threshold of 20 for a plan with a single-feature focus.

---

## Brand voice (tenants.settings.brand_voice)

Shape:

```ts
interface BrandVoice {
  tone: string;              // "playful, irreverent, Lagos-native"
  audience: string;          // "21-30, Lagos nightlife, Instagram-heavy"
  do_list: string[];         // ["Lead with atmosphere, not price", "Use afrobeats references"]
  dont_list: string[];       // ["Never sound corporate", "No emoji-heavy headlines"]
  example_posts: string[];   // 2-3 actual published captions
}
```

`src/lib/ai/brand-voice.ts` exports:
- `brandVoiceSchema` — zod schema; `export type BrandVoice = z.infer<typeof brandVoiceSchema>` (single source of truth)
- `getBrandVoice(tenantSlug): Promise<BrandVoice | null>` — reads `tenants.settings.brand_voice`, validates shape with zod
- `isBrandVoiceComplete(voice): boolean` — all fields present and non-empty, `example_posts.length >= 1`

Validation is write-path only (action layer). A malformed jsonb written via admin client would pass zod parsing failure at read time, returning null — which triggers the "Add your brand voice" banner. Acceptable v1 guardrail.

`/settings/brand-voice/page.tsx` shows a form with these fields. PULSE banner on `/content-briefs` says "Add your brand voice to unlock brief generation" if voice is missing.

---

## Pattern grouping (deterministic, zero AI cost)

`src/lib/ai/group-patterns.ts`:

```ts
interface PatternCluster {
  name: string;           // "Instagram reels (BTS)" | "TikTok venue reveals"
  key: string;            // stable hash input: `${platform}|${content_type}`
  cards: IntelCard[];
  avgVsAverage: number;   // mean of metrics.vsAverage (ignoring nulls)
  avgEngagementRate: number;
}

function groupPatterns(cards: IntelCard[]): PatternCluster[] {
  // 1. Group by (platform, content_type). Discard groups with < 2 cards.
  // 2. Compute avgVsAverage (treat nulls as 1.0 = baseline).
  // 3. Sort by avgVsAverage desc, then avgEngagementRate desc.
  // 4. Return top 3.
}
```

Why deterministic: keeps AI cost tied to brief generation (~1 call per cluster), not card analysis. Also makes it unit-testable without mocks.

---

## Brief generation prompt

`src/lib/ai/generate-brief.ts`:

```
SYSTEM:
You generate content briefs for {tenantName}, a {short description pulled from tenants.settings}.
Brand voice:
- Tone: {brand_voice.tone}
- Audience: {brand_voice.audience}
- Do: {brand_voice.do_list}
- Don't: {brand_voice.dont_list}
- Examples of our voice: {brand_voice.example_posts joined}

You observed a competitor-activity pattern this week:
- Pattern: {cluster.name}
- Top posts:
  {top 3 cards serialized: competitor | platform | summary | engagementRate | vsAverage}

Output JSON matching this schema exactly:
{ title: string, outline: string[], draftContent: string, seoKeywords: string[] }

Return ONLY JSON. No prose, no commentary.

USER: (empty — everything is in system)
```

Model: `anthropic/claude-sonnet-4.6` via AI Gateway.
Input tokens: ~1,200 (~1,000 of which is stable system prompt → cacheable). Output tokens: ~700. Cost per brief on cache miss: ~$0.012. On cache hit: ~$0.004.
Volume: 3 briefs/tenant/week × 2 tenants × 4 weeks = 24 briefs/month. Within a week, the 2nd+ brief for each tenant hits cache → ~$0.20/month total.

**Prompt caching:** system prompt (brand voice + examples + instructions) is stable within a tenant-week. Apply `cache_control: { type: 'ephemeral' }` on the system block via the Anthropic provider options in AI SDK v6. Claude caches for ~5 minutes on ephemeral tier; for our weekly cron that generates multiple briefs per tenant in sequence, this is enough. Cache tokens are logged to `ai_call_log` (columns `cache_read_tokens`, `cache_write_tokens`).

On-demand "Generate from this card" button calls the same function with a single-card cluster.

---

## AI Gateway wiring

`src/lib/ai/gateway.ts`:

```ts
import { generateObject } from 'ai';
import { z } from 'zod';
// AI Gateway auto-routes via `provider/model` strings; no extra SDK import needed
// in AI SDK v6.

type Purpose = 'synthesis';  // only one purpose in this plan; widen in F1/F3

export function getModelId(purpose: Purpose): string {
  switch (purpose) {
    case 'synthesis': return 'anthropic/claude-sonnet-4.6';
  }
}

export const briefSchema = z.object({
  title: z.string().min(1),
  outline: z.array(z.string()).min(1),
  draftContent: z.string().min(10),
  seoKeywords: z.array(z.string()).optional().default([]),
});
```

**Auth:** OIDC-based via `vercel env pull` for automatic token management (no manual key rotation).
**Package:** `ai` (pin to a Next-16-compatible version at install time).

---

## Cron schedule

```ts
// vercel.ts (or vercel.json crons array)
crons: [
  { path: '/api/cron/generate-briefs', schedule: '0 23 * * 6' }  // Sat 23:00 UTC
]
```

Route handler auth: reject any request without `Authorization: Bearer ${env.CRON_SECRET}`.

Idempotency:
```
for each tenant:
  cards ← intel_cards where detected_at >= now() - 7 days
  clusters ← groupPatterns(cards)
  for cluster in top 3 clusters:
    hash ← sha1(`${tenant.slug}|${cluster.key}|${weekOf(now())}`)
    if exists content_briefs where tenant_id=tenant AND pattern_hash=hash:
      continue  // idempotent skip
    brief ← generateBrief(cluster, tenant.brand_voice)
    insert into content_briefs (tenant_id, pattern_hash, triggered_by_type='intel_card', ...)
```

**Error handling (explicit):**

```ts
for (const tenant of tenants) {
  try {
    const cards = await loadIntelCardsLastWeek(tenant.slug);
    const clusters = groupPatterns(cards);
    for (const cluster of clusters.slice(0, 3)) {
      try {
        const hash = patternHash(tenant.slug, cluster.key, startOfWeek(now, 'saturday'));
        if (await briefExists(tenant.slug, hash)) continue;   // idempotent skip
        const brief = await generateBrief(cluster, tenant.brand_voice);  // logs to ai_call_log
        await insertBrief({ ...brief, tenant_slug: tenant.slug, pattern_hash: hash });
      } catch (clusterErr) {
        // per-cluster failure: log to ai_call_log (success=false), continue with next cluster
        await logFailure(tenant.slug, 'cluster', clusterErr);
      }
    }
  } catch (tenantErr) {
    // per-tenant failure (e.g., DB read error): log and move to next tenant
    await logFailure(tenant.slug, 'tenant', tenantErr);
  }
}
```

`startOfWeek(date, 'saturday')` is a pure helper (unit-tested) that returns the Saturday 00:00 UTC of the week containing `date`. This guarantees cron runs on Sat and Sun within the same calendar week produce the same `pattern_hash`.

---

## AI observability (lightweight)

New table (migration 012 continues):

```sql
create table if not exists ai_call_log (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  purpose text not null,                 -- 'synthesis' etc.
  model text not null,                   -- 'anthropic/claude-sonnet-4.6'
  input_tokens int,
  output_tokens int,
  cost_usd numeric(8,4),
  cache_read_tokens int not null default 0,    -- Claude prompt caching: tokens served from cache
  cache_write_tokens int not null default 0,   -- Claude prompt caching: tokens written to cache
  duration_ms int,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_call_log_tenant_created
  on ai_call_log(tenant_slug, created_at desc);

alter table ai_call_log enable row level security;

-- Tenant members can READ their own call log (for future cost dashboard).
-- Writes are service-role only (no insert policy means default-deny for users).
drop policy if exists "members read ai_call_log" on ai_call_log;
create policy "members read ai_call_log" on ai_call_log
  for select using (public.is_tenant_member(tenant_slug));
```

Gateway wrapper writes one row per call including Claude prompt-cache hit/write token counts. Per-tenant cost dashboard deferred to TODO, but RLS allows the read now so the dashboard is a pure frontend add later.

---

## Tests

**New:**

```
tests/unit/group-patterns.test.ts
  - empty input → []
  - single card per (platform, type) → filtered out (< 2 per cluster)
  - 5 cards with 2 clusters (reels, posts) → 2 clusters ordered by avgVsAverage
  - vsAverage=null handling → treated as 1.0
  - more than 3 clusters → only top 3 returned

tests/unit/brand-voice.test.ts
  - getBrandVoice returns null if settings.brand_voice missing
  - zod schema rejects missing tone / audience / empty example_posts
  - isBrandVoiceComplete true only when all fields populated

tests/integration/briefs.test.ts
  - RLS: tenant member reads own briefs, cannot read ghost-tenant briefs
  - generateFromCard with mocked Gateway inserts a row with expected shape
  - pattern_hash unique constraint prevents duplicate briefs for same (tenant, pattern, week)
  - approve flow (status='draft' → 'approved') respects RLS

tests/integration/cron-generate-briefs.test.ts
  - unauthenticated request → 401
  - with CRON_SECRET → runs, returns summary {generated, skipped, failed}
  - second run on same week is a no-op (idempotent)
```

**Extended:**

```
tests/smoke/migrations.test.ts
  + assert content_briefs now has triggered_by_type column
  + assert ai_call_log table exists with RLS enabled

tests/integration/rls.test.ts
  + cross-tenant read denial for content_briefs
  + ai_call_log is service-role-only (tenant user can't read)
```

**AI call mocking:** Vitest v4 + AI SDK v6 — use the AI SDK's test helpers (`simulateReadableStream`, `MockLanguageModelV2`). No real Gateway calls in CI.

**Regression test (CRITICAL — IRON RULE):** existing smoke + RLS tests must keep passing after migration 012 lands. The existing 14 assertions in `tests/smoke/migrations.test.ts` must be preserved; new assertions for `content_briefs.triggered_by_type` and `ai_call_log` are additive.

**Weekly boundary test (from review finding 3.1):**

```
tests/unit/week-of.test.ts
  - startOfWeek('2026-04-18T09:00:00Z', 'saturday') → '2026-04-18T00:00:00Z'
  - startOfWeek('2026-04-19T23:59:00Z', 'saturday') → '2026-04-18T00:00:00Z'  (same week)
  - startOfWeek('2026-04-25T09:00:00Z', 'saturday') → '2026-04-25T00:00:00Z'  (next week)
```

**Cron empty-state test (from review finding 3.2):** tenant with zero intel_cards in the last 7 days → cron returns `{ generated: 0, skipped: 0, failed: 0 }`, no throw, no insertions.

**ai_call_log RLS test (from review finding 3.4):** tenant member reads own logs; cross-tenant read returns empty.

**Playwright E2E (from review finding 3.5):** add `playwright.config.ts`, `tests/e2e/` directory, one test covering: login → `/content-briefs` → sees at least one brief after admin-seeds one.

---

## Coverage diagram

```
CODE PATH COVERAGE (planned)
===========================
[+] src/lib/ai/group-patterns.ts
    │
    └── groupPatterns(cards)
        ├── [★★★ TEST]   empty input → []
        ├── [★★★ TEST]   <2 cards/cluster filtered
        ├── [★★★ TEST]   null vsAverage handling
        └── [★★★ TEST]   top-3 cap

[+] src/lib/ai/brand-voice.ts
    │
    ├── getBrandVoice(slug)
    │   ├── [★★  TEST]   missing setting → null
    │   └── [★★  TEST]   valid blob → parsed
    └── isBrandVoiceComplete(voice)
        └── [★★★ TEST]   each required field missing in turn

[+] src/lib/ai/generate-brief.ts
    │
    └── generateBrief(cluster, voice)
        ├── [★★★ TEST]   happy path (mocked gateway) → valid brief JSON
        ├── [★★  TEST]   gateway error → throws BriefGenerationError
        ├── [★★  TEST]   schema validation failure (model returns malformed JSON)
        └── [GAP] [→EVAL] prompt-quality eval — needs baseline briefs for diff

[+] src/lib/actions/briefs.ts
    │
    ├── generateFromCard(cardId)  [server action]
    │   ├── [★★★ TEST]   tenant member → inserts brief
    │   └── [★★★ TEST]   non-member → RLS rejects
    └── updateStatus(briefId, status)
        ├── [★★  TEST]   draft → approved
        └── [★★  TEST]   cross-tenant → denied

[+] src/app/api/cron/generate-briefs/route.ts
    │
    └── POST
        ├── [★★★ TEST]   no auth → 401
        ├── [★★★ TEST]   valid auth, single tenant → generates briefs
        ├── [★★★ TEST]   idempotent re-run → skips
        └── [★★  TEST]   Gateway partial failure → logs + continues

USER FLOW COVERAGE
===========================
[+] Settings → Brand Voice editor
    ├── [★★  TEST]   save flow, refetch shows values
    └── [GAP]         empty → banner prompts to fill

[+] /content-briefs page
    ├── [★★  TEST]   list renders briefs for current tenant only
    ├── [★★  TEST]   edit draftContent, save
    └── [★★  TEST]   mark approved toggles status

[+] Weekly cron → brief appears in list by Sunday morning
    └── [★★★ TEST]   end-to-end with mocked Gateway (integration)

─────────────────────────────────
COVERAGE: 17/18 paths tested (94%)
QUALITY:  ★★★: 10   ★★: 7
GAPS: 1 path flagged [→EVAL] — prompt-quality eval (deferred, needs baseline)
─────────────────────────────────
```

Test plan artifact written to `~/.gstack/projects/Pulse/{user}-main-eng-review-test-plan-{timestamp}.md` for /qa consumption.

---

## Performance notes

- Cron runs once/week, single tenant-loop, ~3 AI calls per tenant. Well under Vercel function timeout (300s default).
- `groupPatterns` is O(n) over intel_cards/week (current rate: ~10 cards/week per tenant). Negligible.
- `/content-briefs` page query: `select … where tenant_id = … order by generated_at desc limit 50` with index on `(tenant_id, generated_at desc)`. Add this index in migration 012.
- No N+1 concerns — brief lookup is single query; brand_voice is one jsonb read per page.

```sql
-- in migration 012:
create index if not exists idx_content_briefs_tenant_generated
  on content_briefs(tenant_id, generated_at desc);
```

---

## Rollout gates

| Day | Ship | Validation gate |
|---|---|---|
| 1 | Migration 012 + brand voice editor | Abas + Priye each fill out brand voice for both tenants (~30 min, manual) |
| 2-3 | Brief generator + on-demand button on intel cards | Priye generates 5 briefs by hand from existing intel_cards. Rates each 1-5. |
| 4 | Weekly cron + /content-briefs page | Sunday run fires, inserts briefs without errors |
| 7 | Kill-gate review | If Priye's average rating on 5 briefs < 3/5, **pause cron**, iterate on prompt before continuing |

If AI Gateway costs exceed $5/month in any billing cycle, investigate before allowing further cron runs.

---

## Failure modes

| Codepath | Realistic failure | Test? | Error handling? | User sees? |
|---|---|---|---|---|
| Cron POST | CRON_SECRET leaked, bad actor triggers cron | No (test covers auth only) | Rejects on bad auth, logs attempt | No direct impact |
| Gateway call | Rate-limit / 5xx | Yes (mocked) | Try/catch, log to ai_call_log, skip cluster | Brief missing from list; no error toast |
| Model returns malformed JSON | Hallucinated non-JSON output | Yes | zod schema validation throws; logged; skipped | Brief missing from list |
| Idempotency race | Two cron invocations hit same hash | No (single-region cron; not a realistic Vercel scenario) | Unique constraint throws; caught; logged | Second insert silently skipped |
| Brand voice missing | Tenant hasn't filled it in | Yes | Banner on /content-briefs; cron skips tenant | Clear "Add your brand voice" UX |
| **Critical gap watch:** `example_posts` blank but other fields filled → brief generator still runs but with weak grounding → low-quality briefs | Partial | zod requires `example_posts.length >= 1` — no partial state reaches Gateway | Clear validation error in editor |

No critical-gap failure modes identified (all either tested, handled, or have a user-visible error state).

---

## Parallelization strategy

Sequential implementation — single module, tight coupling between steps. No worktree parallelization opportunity.

---

## Dependencies

- Migration 012 applied (requires `SUPABASE_DB_PASSWORD` for CI apply or manual SQL Editor)
- OIDC-based auth for AI Gateway via `vercel env pull` (automatic token management, no manual rotation)
- `CRON_SECRET` set in Vercel env (all three environments)
- `ai` package added to dependencies, pinned to Next-16-compatible version
- Existing: Supabase, Vercel deploy pipeline, Vitest

---

## Brief list query (no N+1)

`src/lib/services/briefs.ts listBriefs(tenantSlug)` uses a single query with PostgREST join:

```ts
supabase
  .from('content_briefs')
  .select('*, intel_cards!triggered_by(competitor_name, platform)')
  .eq('tenant_id', tenantSlug)
  .order('generated_at', { ascending: false })
  .limit(50);
```

One round-trip per page load. The `!triggered_by` foreign-key relationship resolves to an optional embedded object (null when `triggered_by_type='manual'`).

## Design specifications (from /plan-design-review)

### Information architecture

```
/content-briefs
  PRIMARY:    Brief list (cards, newest first) — the work surface
  SECONDARY:  Header (title, count, status filter)
  TERTIARY:   Intel Feed pointer when list is empty or sparse

/settings/brand-voice
  PRIMARY:    The 5 fields (tone, audience, do_list, dont_list, example_posts)
  SECONDARY:  Placeholder CTA "Infer from posts" (disabled — future TODO)
  TERTIARY:   Last-saved timestamp + byline

BriefEditor (modal or inline expand)
  PRIMARY:    draftContent textarea — Priye's edit surface
  SECONDARY:  title (editable)
  TERTIARY:   outline (read-only, collapsed by default)
  CONTEXT:    "Triggered by [competitor] · [platform]" breadcrumb
  FOOTER:     Cancel · Save Draft · Mark Approved
```

### Interaction states

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| `/content-briefs` list | 3 skeleton cards | "No briefs yet. Head to Intel Feed and tap Generate." | "Couldn't load briefs. Retry." | Fade-in new cards | Silent — failed briefs only in `ai_call_log` |
| Brand voice editor | Button spinner on save | Blank form (new tenant) | Inline field errors (zod-mapped) | Toast: "Brand voice saved" | N/A (atomic save) |
| BriefEditor | Button spinner on save | N/A (always prefilled) | Inline save error + retry | Toast + back to list | Dirty indicator + unsaved-changes warn-on-close |
| Generate-from-card | Button: "Generating..." + spinner | N/A | Toast: "Generation failed. Try again." | Link to new brief in toast | N/A |
| Brand voice missing | N/A | Banner on `/content-briefs`: "Add your brand voice to unlock briefs" + CTA | N/A | Banner disappears when voice complete | N/A |

**Cron partial-failure surfacing: silent.** Failed cluster generations write a row to `ai_call_log` with `success=false`. The user-facing `/content-briefs` shows only successes. Rationale: invisible = perfect.

### Priye's Sunday-morning journey

| Step | Does | Feels | Plan supports? |
|---|---|---|---|
| Sunday AM | Opens `/content-briefs` | Curious | YES — fresh briefs first |
| First scan | Reads title + outline | Decisive | YES — title is primary, outline secondary |
| Opens brief | Reads draftContent | Critical | YES — breadcrumb shows the inspiring intel_card |
| Edits | Changes a sentence | Ownership | YES — dirty indicator + explicit save |
| Approves | Marks approved | Committed | YES — status transition |
| Week later | Sees 3 more | Trust | YES — cron reliability (tested) |
| Bad brief | Dismisses slop | Relieved (no shame) | YES — soft-delete with reason field for prompt tuning |

### Component composition

All UI composes from existing `src/components/ui/` primitives — no new primitives introduced.

| Component | Composes | Tokens | Interaction |
|---|---|---|---|
| `BriefCard` | `Card` (`bg-card`, `rounded-2xl`, `p-5`) | `text-foreground`, `text-text-secondary`, `text-text-muted` | Click expands / opens `BriefEditor` |
| `BriefEditor` | `Card` + `Textarea` + `Input` + `Button` (pill, CVA) | Brand palette; `border-primary/30` focus ring | **Explicit save**: Save Draft button + dirty dot in title + `beforeunload` warn when dirty. `Cmd/Ctrl+Enter` saves. |
| `BrandVoiceEditor` | `Card` + `Input` + `Textarea` + `Button` | Same | Atomic save on submit. Field-level zod error messages under each input. |
| Status badge | `Badge.tsx` — ADD variants `approved` (green) and `dismissed` (muted gray) alongside existing `draft_status`, `published` | Badge tokens | Optional v2: click to cycle |
| "Generate" on Intel Feed | `Button` variant="primary" (pill) | `bg-primary text-white` | Loading: `disabled` + spinner + text "Generating..." |
| Empty-voice banner | Custom card with `border-dashed border-border` | `text-foreground`, `text-text-muted` | Pill CTA → `/settings/brand-voice` |

**Pre-existing tech debt cleanup (IN SCOPE for this rebuild):** the current `content-briefs/page.tsx` uses `accent-purple`/`purple-300` tokens which drift from the Gruve maroon brand per `DARK-THEME.md`. When rebuilding, replace all purple tokens with theme-aware brand tokens (`bg-primary-50`, `text-primary`, etc.).

### Responsive

| Breakpoint | `/content-briefs` | `/settings/brand-voice` | BriefEditor |
|---|---|---|---|
| sm (<640) | single column, `p-4`, header stacks | single column, fields stack | **Full-screen takeover** (native mobile edit pattern) |
| md (<1024) | single column, `p-5`, header inline | 2-col field pairs (tone/audience, do/don't), `example_posts` full-width | Modal overlay `max-w-[720px]` |
| lg (1024+) | `max-w-[1000px]` centered (matches existing page max-width convention) | same as md, capped at ~760px readable width | Same modal, centered |

### A11y

- Every form field has a visible `<Label>` from `label.tsx` (no placeholder-as-label)
- Focus indicator: Tailwind `focus-visible:ring-2 ring-primary` (already in `Button.tsx` via CVA — extend to inputs)
- Touch targets: all buttons `min-h-[44px]` (pill buttons already comply)
- Keyboard: `Escape` closes BriefEditor; `Cmd/Ctrl+Enter` saves
- ARIA: `<main>` landmark per page; `aria-live="polite"` on toast region
- Contrast: body text ≥4.5:1 (Satoshi Regular on `bg-card` already satisfies in both themes)
- Dismiss: confirmable for `approved` briefs; undo available for 5s via toast
- Screen reader: `BriefCard` reads "Content brief: {title}, status {status}, generated {relative-date}"

## Design doc freshness

The approved design doc `~/.gstack/projects/Pulse/aiseosauyi-idahor-main-design-20260415-174616.md` describes the original content_briefs schema. After migration 012 lands, the schema section of that doc is stale. Either (a) append a "Superseded by migration 012" note to the design doc, or (b) write a new design doc via `/office-hours` with `Supersedes:` pointing back. Pick (a) for minimal diff — this is a schema extension, not a fundamental rethink.

## The ask from engineering review

1. Is the reduced scope (F2 only) the right MVP, or should we go even smaller and ship only the on-demand button first (no cron)?
2. Is the single-nullable-`triggered_by` FK approach sustainable, or should we bite the bullet and go two-FK now?
3. Is `ai_call_log` with no RLS policy the right baseline (service-role-only), or should tenants see their own costs?
4. Should the kill-gate at Day 7 be mechanical (auto-pause if ratings < threshold) or human-in-loop (Priye tells us)?
5. Any smell in doing deterministic `groupPatterns` vs LLM-based pattern detection for v1?

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 9 issues surfaced, 9 resolved, scope reduced from 3 features to F2 only |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score: 5/10 → 9/10, 6 decisions added (info arch, states, journey, design-system, responsive, a11y, dismiss UX, save model) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0

**VERDICT:** ENG + DESIGN CLEARED — ready to implement F2 (competitor → content brief generator). F1 (own analytics) and F3 (viral spotting) tracked in `TODOS.md` as separate plans.

