# Pulse Implementation Spec — AI SEO Operating System

**Owner:** AI Platform Engineering
**Stack baseline:** Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres + Auth + RLS) · AI SDK v6 · OpenAI · Claude · Vercel Workflow DevKit · pgvector
**Status:** v1 spec — implement inside existing Pulse repo
**Last updated:** 2026-05-11

> Move this file into the Pulse repo. It lives in Gruve only because it was generated alongside the Gruve specs.

---

## 1. Purpose and scope

Pulse becomes the **central SEO operating system** for Gruve (and other tenants like Sippy). This spec covers the AI SEO module specifically — not the entire Pulse platform.

In scope:

1. AI blog generation workflows (brief → draft → review → approve).
2. Editorial approval state machine.
3. Contentful publishing orchestration (CMA upserts, asset uploads, retries).
4. SEO scoring + recommendation engine.
5. Keyword tracking and content decay monitoring.
6. Internal linking engine (embeddings + vector search).
7. Schema markup generation.
8. Analytics ingestion (GSC, GA4, Gruve backend APIs).
9. AI orchestration patterns (gateway, telemetry, cost control).

Pulse is already multi-tenant; the SEO module attaches at `tenant_slug = 'gruvetickets'` and reuses existing brand voice, audit, and AI gateway plumbing.

---

## 2. Architecture decisions

| Decision | Choice | Rationale |
|---|---|---|
| AI gateway | Reuse `src/lib/ai/gateway.ts` — extend `getModel(purpose)` with `'seo-longform'`, `'seo-scoring'`, `'seo-vision'`, `'embeddings'` purposes | Centralized model routing + cost tracking via `ai_call_log` |
| Long-form model | Claude Opus 4.7 via Anthropic, fallback GPT-4.1 | Opus produces stronger longform; GPT for batch tasks |
| Embeddings | OpenAI `text-embedding-3-large` (3072 dims) — store in pgvector | Best quality/cost ratio |
| Workflow engine | Vercel Workflow DevKit | Crash-safe publish + scheduled refresh workflows |
| Vector DB | pgvector inside Supabase | Already on Supabase, no new dependency; supports HNSW |
| CMS client | `contentful-management` SDK | Official, supports per-step idempotency |
| Rich text conversion | `@contentful/rich-text-from-markdown` + custom transformer for embedded refs | LLM emits markdown; transform server-side |
| Editorial UI | Existing Tiptap editor extended with SEO panel | No new editor stack |
| Analytics ingest | Daily cron jobs into `seo_*` tables | Reuse `web_analytics_daily` pattern |
| Decay detection | Statistical (moving averages); not ML for v1 | Simpler, explainable |
| Recommendation persistence | Dedicated `seo_recommendations` table with outcome tracking | Critical for feedback loop |

---

## 3. Folder structure (extensions to existing Pulse layout)

```
src/lib/
  ai/
    seo/
      generate-blog.ts             # NEW — brief → draft AI flow
      score-seo.ts                 # NEW — SEO scoring agent
      suggest-title.ts             # NEW — CTR-driven title rewrite
      suggest-meta.ts              # NEW — meta description rewrite
      suggest-faq.ts               # NEW — PAA → FAQPage
      suggest-internal-links.ts    # NEW — embeddings-based
      detect-decay.ts              # NEW — statistical decay detection
      content-refresh.ts           # NEW — rewrite outdated sections
      schema-builder.ts            # NEW — JSON-LD generator
  contentful/
    cma.ts                         # NEW — CMA SDK singleton (factory)
    publish.ts                     # NEW — publish workflow steps
    asset-upload.ts                # NEW — image upload step
    map-payload.ts                 # NEW — Pulse model → Contentful fields
    markdown-to-rich-text.ts       # NEW
  integrations/
    gsc.ts                         # NEW — Google Search Console
    ga4.ts                         # exists — extend per-page metrics
    serper.ts                      # exists — reuse for keyword ranks
    dataforseo.ts                  # NEW — SERP + keywords (optional, paid tier)
    ahrefs.ts                      # NEW — backlinks (optional, paid tier)
  workflows/
    publish-blog.workflow.ts       # NEW — durable publish
    refresh-blog.workflow.ts       # NEW — durable refresh
    embed-blog.workflow.ts         # NEW — generate + store embedding
  vector/
    embed.ts                       # NEW — wrapper around embeddings API
    search.ts                      # NEW — cosine search via pgvector
  services/
    seo-drafts.ts                  # NEW — draft CRUD
    seo-posts.ts                   # NEW — published post index
    seo-metrics.ts                 # NEW — read-side metrics
    seo-recommendations.ts         # NEW
  actions/
    seo-drafts.ts                  # NEW — server actions for create/edit/approve
    seo-publish.ts                 # NEW — kick off publish workflow
    seo-recommendations.ts         # NEW — apply/dismiss

src/app/(app)/(intelligence)/
  seo/
    page.tsx                       # NEW — SEO dashboard
    drafts/
      page.tsx                     # NEW — drafts list
      [id]/page.tsx                # NEW — editor
      [id]/preview/page.tsx        # NEW — iframe Gruve preview
    posts/
      page.tsx                     # NEW — published posts table
      [slug]/page.tsx              # NEW — per-post analytics + recs
    recommendations/
      page.tsx                     # NEW — global recs inbox
    keywords/
      page.tsx                     # NEW — keyword tracker
    decay/
      page.tsx                     # NEW — decay alerts

src/app/api/
  cron/
    seo-gsc-sync/route.ts          # NEW
    seo-ga4-sync/route.ts          # NEW
    seo-keyword-ranks/route.ts     # NEW
    seo-decay-scan/route.ts        # NEW
    seo-embed-backfill/route.ts    # NEW
  webhooks/
    contentful/route.ts            # NEW — Pulse-side receiver
    gruve/route.ts                 # NEW — Gruve revalidation confirmations
```

---

## 4. AI generation workflow

### 4.1 Brief → Draft

Input: a content brief (already a first-class Pulse object — `content_briefs` table). Output: a typed `PulseBlogDraft`.

Pipeline:

1. **Brand context fetch** — `getBrandContext(tenantSlug)` produces voice, positioning, banned phrases, brand pillars.
2. **Keyword and SERP context** — pull top 10 Google results for primary keyword via Serper; extract titles, H2s, average word count, schema presence.
3. **Outline generation** — Claude Opus call with structured output (Zod-strict): `{ title, slug, metaTitle, metaDescription, sections: [{ h2, h3s[], bullets[] }] }`. Targets word count derived from competitors (+10-20%).
4. **Section drafting** — for each section, parallel calls to draft prose (Sonnet for speed). Stitch.
5. **Coverage check** — run `score-seo.ts` agent; if score <70, regenerate weakest section.
6. **Schema candidates** — detect `how-to`, FAQ, video patterns; build JSON-LD via `schema-builder.ts`.
7. **Cover image** — call image gen (DALL·E 3 or Flux) with brand-locked prompt; or pull from a curated stock set.
8. **Persist** as `seo_drafts` row, status = `drafted`.

Every AI call logs to `ai_call_log` via `logAiCall()`. Cost per blog post is tracked end-to-end and exposed on the draft detail page.

### 4.2 SEO scoring (`score-seo.ts`)

Score = weighted composite, 0-100:

| Dimension | Weight | Signal |
|---|---|---|
| Title quality | 10 | Length 40-60 chars, primary keyword presence, sentiment |
| Meta description | 8 | Length 120-155 chars, keyword, CTA verb |
| H1 hygiene | 5 | Exactly one H1, contains keyword |
| Heading depth | 5 | H2/H3 hierarchy, sufficient coverage |
| Keyword density + variation | 10 | Primary + LSI, no stuffing |
| Internal links | 10 | ≥3 internal links to existing posts, ≥1 to event page |
| External authority | 5 | ≥2 outbound to high-DR domains |
| Image alts | 5 | All images have descriptive alts |
| Schema | 10 | Article + breadcrumb minimum; bonus FAQ/HowTo |
| Readability | 10 | Flesch-Kincaid 60-80 |
| Length vs SERP | 10 | Within ±20% of average competitor length |
| Originality | 12 | Embedding similarity vs SERP <0.85 (avoid generic) |

Recompute on every save. Show breakdown in the editor sidebar.

### 4.3 Approval state machine

```
drafted
   │ submit
   ▼
in_review
   │ approve            │ request_changes
   ▼                    ▼
seo_approved        drafted (back to author)
   │ schedule
   ▼
scheduled
   │ publish_time reached / immediate publish
   ▼
publishing
   │ success           │ failure
   ▼                   ▼
published         publish_failed
                     │ retry / manual fix
                     ▼
                  publishing (back)
```

Transitions are atomic Postgres updates with `optimistic_lock` (version column). Audit row per transition.

---

## 5. Contentful publishing orchestration

### 5.1 Workflow (`publish-blog.workflow.ts`)

Implemented with Vercel Workflow DevKit. Each step is durably checkpointed.

```ts
export const publishBlog = workflow({
  id: 'publish-blog',
  async run(ctx, input: { draftId: string }) {
    const draft = await ctx.step('load-draft', () => loadDraft(input.draftId));
    await ctx.step('validate', () => validatePayload(draft));

    const cover = await ctx.step('upload-cover',
      () => uploadAsset(draft.coverImage),
      { retries: 3, backoff: 'exponential' }
    );

    const inlineAssets = await ctx.step('upload-inline-assets',
      () => Promise.all(draft.inlineImages.map(uploadAsset)),
      { retries: 3 }
    );

    const entry = await ctx.step('upsert-entry',
      () => upsertContentfulEntry(draft, { cover, inlineAssets }),
      { retries: 3 }
    );

    await ctx.step('publish-entry',
      () => publishContentfulEntry(entry.sys.id, entry.sys.version),
      { retries: 5 }
    );

    await ctx.step('notify-gruve',
      () => notifyGruveRevalidate(draft.slug),
      { retries: 3 }
    );

    await ctx.step('write-post-index',
      () => insertSeoPost({ draft, entryId: entry.sys.id })
    );

    await ctx.step('embed',
      () => triggerEmbed(draft.slug)
    );

    await ctx.step('mark-published',
      () => setDraftStatus(draft.id, 'published')
    );
  },
});
```

### 5.2 Idempotency

- `seo_drafts.contentful_entry_id` is unique; first publish creates, retries update.
- Before creating an entry, query Contentful by custom field `pulseId` (set on the content model) — if found, use that entry.
- `seo_drafts.publish_run_id` references the workflow run; the UI shows live progress.

### 5.3 Asset upload (`asset-upload.ts`)

```
1. POST /spaces/{id}/uploads — multipart upload of binary
2. POST /spaces/{id}/assets with upload reference
3. PUT /spaces/{id}/assets/{aid}/files/en-US/process
4. Poll GET /spaces/{id}/assets/{aid} until `fields.file[locale].url` exists (timeout 120s)
5. PUT /spaces/{id}/assets/{aid}/published
```

Each step retried independently. Track asset state in `seo_asset_uploads` so retries don't double-upload binaries.

### 5.4 Content model mapping (`map-payload.ts`)

Pulse `seo_drafts` → Contentful `blogPost`:

| Pulse field | Contentful field | Type |
|---|---|---|
| `title` | `title` | Symbol |
| `slug` | `slug` | Symbol (unique) |
| `excerpt` | `excerpt` | Text |
| `body_rich_text` | `body` | RichText |
| `cover_asset_id` | `coverImage` | Link (Asset) |
| `seo_meta_title` | `seoTitle` | Symbol |
| `seo_meta_description` | `seoDescription` | Symbol |
| `canonical_override` | `canonicalUrl` | Symbol (optional) |
| `tags[]` | `tags` | Array<Symbol> |
| `author_contentful_id` | `author` | Link (Entry) |
| `published_at` | `publishedAt` | Date |
| `pulse_metadata` | `pulseMetadata` | Object (hidden) |
| `json_ld_overrides` | `jsonLd` | Object (optional) |

Add `pulseId` (Symbol, indexed) field to the Contentful model for lookups.

### 5.5 Publish-fail handling

On any step failure after max retries:

1. Workflow halts; `publish_run.status = 'failed'`.
2. `seo_drafts.status = 'publish_failed'`; populate `last_error_jsonb`.
3. Editor sees a red banner in the editor with the error, the failed step, and a "Retry from <step>" button.
4. Slack notification to `#pulse-alerts`.

Never delete a partially-created Contentful entry on failure — preserve for inspection. Manual cleanup via admin tool.

---

## 6. SEO recommendation engine

### 6.1 Recommendation types

| Type | Trigger | Action |
|---|---|---|
| `title_rewrite` | GSC CTR < 0.6× SERP norm at current avg position | Generate 3 alternatives, A/B if testing infra exists |
| `meta_rewrite` | Same as title, plus current meta description >155 chars | Generate alternatives |
| `internal_link_add` | New post embedding has cosine sim >0.78 with existing posts not yet linking to it | Suggest link with anchor text |
| `internal_link_receive` | Existing post would benefit from incoming link from new post | Suggest |
| `faq_add` | SERP has PAA box for primary keyword; post has no FAQ schema | Generate FAQPage |
| `schema_add` | Eligible content pattern (how-to, video) lacks schema | Generate JSON-LD |
| `content_refresh` | Page traffic decayed >25% MoM; SERP top-3 changed | Generate refresh diff |
| `keyword_capture` | GSC shows query at positions 5-15 with >100 impressions/mo | Suggest content edits targeting the query |
| `decay_alert` | 30-day MA < 0.75 × 90-day MA | Surface for human review |
| `backlink_outreach` | Ahrefs intersection shows site linking to ≥3 competitors but not us | Outreach target |

### 6.2 Recommendation lifecycle

```
generated → surfaced → (applied | dismissed | snoozed) → measured (30d outcome)
```

Outcome tracking: when a `title_rewrite` is applied, snapshot CTR/position; 30 days later, snapshot again. Diff → `seo_recommendations.outcome_30d`. This dataset is what makes the recommendation engine improve over time.

### 6.3 Apply UX

For high-confidence recs (e.g., internal link adds), one-click apply:

1. User clicks "Apply."
2. Pulse fetches Contentful entry.
3. Patches the affected field (rich text node insertion for internal links; field update for title/meta).
4. Publishes.
5. Workflow as in Section 5.
6. Marks recommendation `applied`.

For lower-confidence recs (content refresh), open the draft editor with proposed diff highlighted.

---

## 7. Keyword tracking

### 7.1 Sources

- **GSC API** (free): impressions/clicks/position/CTR per query per page, daily.
- **DataForSEO** (paid, ~$0.05/keyword/month): explicit SERP positions, SERP feature presence.
- **Serper** (already integrated): on-demand SERP snapshots for new keyword research.

### 7.2 Tables

```sql
create table seo_tracked_keywords (
  id              uuid primary key default gen_random_uuid(),
  tenant_slug     text not null references tenants(slug) on delete cascade,
  keyword         text not null,
  primary_for     text,                    -- slug this keyword is "the" target for
  intent          text,                    -- 'informational' | 'transactional' | 'navigational'
  difficulty      int,
  search_volume   int,
  added_at        timestamptz default now(),
  unique (tenant_slug, keyword)
);

create table seo_keyword_ranks_daily (
  date            date not null,
  tenant_slug     text not null,
  keyword         text not null,
  url             text not null,
  position        numeric,
  impressions     int,
  clicks          int,
  ctr             numeric,
  source          text not null,           -- 'gsc' | 'dataforseo' | 'serper'
  primary key (date, tenant_slug, keyword, url, source)
);
```

### 7.3 Cron jobs

- `seo-gsc-sync` — daily 06:00 UTC; pull last 3 days (data lags); upsert per `(date, query, url)`.
- `seo-keyword-ranks` — daily 07:00 UTC; for tracked keywords without GSC coverage, fall back to DataForSEO/Serper.

---

## 8. GSC integration

```ts
// src/lib/integrations/gsc.ts
import { google } from 'googleapis';

async function gscClient(tenantSlug: string) {
  const creds = await loadServiceAccountCreds(tenantSlug); // from tenant_integrations
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  return google.searchconsole({ version: 'v1', auth });
}

export async function pullSearchAnalytics(
  tenantSlug: string,
  siteUrl: string,
  start: string,
  end: string
) {
  const client = await gscClient(tenantSlug);
  const res = await client.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: start,
      endDate: end,
      dimensions: ['query', 'page', 'date'],
      rowLimit: 25000,
      dataState: 'all',
    },
  });
  return res.data.rows ?? [];
}
```

Per-tenant credentials stored in `tenant_integrations.encrypted_creds`. Site URL stored in `tenants.settings.gsc.siteUrl`.

---

## 9. GA4 integration

Pulse already has `src/lib/integrations/ga4.ts`. Extend with per-page metrics:

```ts
export async function pullPageMetricsDaily(
  tenantSlug: string,
  start: string,
  end: string
) {
  const client = await ga4Client(tenantSlug);
  const [resp] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'pagePath' }, { name: 'date' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'engagedSessions' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
      { name: 'conversions' },
    ],
    limit: 100000,
  });
  return resp.rows;
}
```

Upsert into `seo_page_metrics_daily`.

---

## 10. Content decay monitoring

Algorithm (`detect-decay.ts`):

1. For each published slug, compute trailing 30-day clicks (MA30) and 90-day clicks (MA90).
2. Compute decay score: `1 - (MA30 / MA90)`.
3. Flag if decay score > 0.25 AND MA90 > 50 clicks (avoid false positives on low-traffic posts).
4. Confirm against SERP: pull current top 10 for primary keyword; compare against snapshot from publish date. If top 3 changed materially, decay is likely competitive displacement.
5. Generate `decay_alert` recommendation.

Cron: daily 08:00 UTC.

---

## 11. Internal linking engine

### 11.1 Embeddings storage

```sql
create extension if not exists vector;

create table seo_post_embeddings (
  tenant_slug     text not null,
  slug            text not null,
  embedding       vector(3072) not null,
  content_hash    text not null,
  embedded_at     timestamptz default now(),
  primary key (tenant_slug, slug)
);

create index on seo_post_embeddings using hnsw (embedding vector_cosine_ops);
```

Generated post-publish via `embed-blog.workflow.ts`: pull body text → embed via `text-embedding-3-large` → upsert.

### 11.2 Link suggestion

```sql
-- Given a new post embedding, find candidates that don't already link to it
select p.slug, 1 - (e.embedding <=> $1) as sim
from seo_post_embeddings e
join seo_posts p using (tenant_slug, slug)
where e.tenant_slug = $2
  and p.slug != $3
  and not exists (
    select 1 from seo_internal_links l
    where l.tenant_slug = $2
      and l.from_slug = p.slug
      and l.to_slug = $3
  )
order by e.embedding <=> $1 asc
limit 10;
```

For each candidate, an AI call generates anchor text suggestions grounded in the source post's body. Surface as `internal_link_add` recommendations.

### 11.3 Crawled link graph

Daily crawler against `gruve.events/blogs/*` populates `seo_internal_links(from_slug, to_slug, anchor)`. This is the ground truth — embeddings suggest *missing* edges.

---

## 12. Schema generation (`schema-builder.ts`)

Functions, one per schema type, all returning typed JSON-LD objects validated against schema.org examples in unit tests.

- `buildArticleSchema(draft)` — base Article/BlogPosting.
- `buildBreadcrumbSchema(slug, taxonomy)` — BreadcrumbList.
- `buildFAQSchema(faqItems)` — FAQPage.
- `buildHowToSchema(steps)` — HowTo.
- `buildVideoSchema(asset)` — VideoObject.

Output stored in `seo_drafts.json_ld_blocks` (array). Gruve frontend renders each block in a `<Script type="application/ld+json">`.

---

## 13. Database schema (Supabase migration `039_seo_module.sql`)

```sql
-- Drafts
create table seo_drafts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_slug           text not null references tenants(slug) on delete cascade,
  brief_id              uuid references content_briefs(id) on delete set null,
  version               int  not null default 1,
  status                text not null check (status in (
    'drafted','in_review','seo_approved','scheduled',
    'publishing','published','publish_failed','archived'
  )),
  title                 text not null,
  slug                  text not null,
  excerpt               text,
  body_markdown         text,
  body_rich_text        jsonb,
  cover_image           jsonb,
  inline_images         jsonb default '[]'::jsonb,
  seo_meta_title        text,
  seo_meta_description  text,
  canonical_override    text,
  tags                  text[] default '{}',
  author_contentful_id  text,
  json_ld_blocks        jsonb default '[]'::jsonb,
  scheduled_at          timestamptz,
  published_at          timestamptz,
  contentful_entry_id   text unique,
  contentful_version    int,
  pulse_metadata        jsonb,
  seo_score             int,
  last_error            jsonb,
  publish_run_id        text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  created_by            uuid references auth.users(id),
  unique (tenant_slug, slug)
);

-- Approvals
create table seo_approvals (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references seo_drafts(id) on delete cascade,
  reviewer    uuid not null references auth.users(id),
  decision    text not null check (decision in ('approved','changes_requested')),
  comment     text,
  decided_at  timestamptz default now()
);

-- Publish runs
create table seo_publish_runs (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid not null references seo_drafts(id),
  workflow_run_id   text,
  status            text not null,
  started_at        timestamptz default now(),
  finished_at       timestamptz,
  error             jsonb
);
create table seo_publish_run_steps (
  run_id      uuid not null references seo_publish_runs(id) on delete cascade,
  step        text not null,
  attempt     int  not null,
  status      text not null,
  duration_ms int,
  payload     jsonb,
  recorded_at timestamptz default now(),
  primary key (run_id, step, attempt)
);

-- Published posts index
create table seo_posts (
  tenant_slug         text not null references tenants(slug) on delete cascade,
  slug                text not null,
  contentful_entry_id text not null,
  title               text not null,
  published_at        timestamptz not null,
  last_updated_at     timestamptz,
  taxonomy            jsonb,
  primary key (tenant_slug, slug)
);

-- Metrics
create table seo_page_metrics_daily (
  date           date not null,
  tenant_slug    text not null,
  slug           text not null,
  impressions    int default 0,
  clicks         int default 0,
  ctr            numeric,
  position       numeric,
  views          int default 0,
  engaged        int default 0,
  bounce_rate    numeric,
  avg_duration_s numeric,
  conversions    int default 0,
  primary key (date, tenant_slug, slug)
);

-- Recommendations
create table seo_recommendations (
  id              uuid primary key default gen_random_uuid(),
  tenant_slug     text not null references tenants(slug) on delete cascade,
  slug            text,
  type            text not null,
  payload         jsonb not null,
  score           numeric not null,
  status          text not null default 'surfaced',
  surfaced_at     timestamptz default now(),
  applied_at      timestamptz,
  dismissed_at    timestamptz,
  snoozed_until   timestamptz,
  outcome_30d     jsonb,
  reviewer        uuid references auth.users(id)
);

-- Internal links graph (crawled)
create table seo_internal_links (
  tenant_slug     text not null,
  from_slug       text not null,
  to_slug         text not null,
  anchor          text,
  observed_at     timestamptz default now(),
  primary key (tenant_slug, from_slug, to_slug)
);

-- Webhook events from Contentful/Gruve
create table seo_webhook_events (
  id           bigserial primary key,
  source       text not null,
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz default now(),
  processed_at timestamptz,
  signature_ok boolean
);

-- RLS — same pattern as existing tables
alter table seo_drafts enable row level security;
create policy "tenant members read" on seo_drafts
  for select using (is_tenant_member(tenant_slug));
-- ... etc per table
```

---

## 14. AI orchestration patterns

### 14.1 Gateway extension

```ts
// src/lib/ai/gateway.ts (extension)
type Purpose =
  | 'synthesis' | 'scoring' | 'vision'
  | 'seo-longform' | 'seo-scoring' | 'seo-vision' | 'embeddings';

export function getModel(purpose: Purpose) {
  switch (purpose) {
    case 'seo-longform': return anthropic('claude-opus-4-7');
    case 'seo-scoring':  return openai('gpt-4.1-mini');
    case 'seo-vision':   return openai('gpt-4o');
    case 'embeddings':   return openai.embedding('text-embedding-3-large');
    // ... existing
  }
}
```

Every call wrapped:

```ts
const start = Date.now();
try {
  const result = await generateObject({ model: getModel('seo-longform'), schema, prompt });
  await logAiCall({
    purpose: 'seo-longform',
    tenant: tenantSlug,
    duration_ms: Date.now() - start,
    tokens_in: result.usage.promptTokens,
    tokens_out: result.usage.completionTokens,
    cost_usd: calcCost(result.usage, 'claude-opus-4-7'),
    success: true,
  });
  return result;
} catch (e) {
  await logAiCall({ /* ...success: false, error: e.message */ });
  throw e;
}
```

### 14.2 Structured output

OpenAI strict mode requires every property in `required`. Use `.nullable()` not `.optional()` per existing Pulse convention. Schemas live alongside their generators in `src/lib/ai/seo/*.ts`.

### 14.3 Cost control

Per-tenant monthly AI budget configurable in `tenants.settings.ai_budget_usd`. Mid-month, when 80% consumed, alert tenant owner. When 100% consumed, generation actions return a budget-exceeded error; reads continue.

---

## 15. Webhooks (Pulse-side)

### 15.1 Contentful → Pulse

Endpoint: `POST /api/webhooks/contentful`

Pulse listens for the same events Gruve does — but for *different reasons*. When Contentful publish webhook fires, Pulse:

1. Updates `seo_drafts.status = 'published'` (if draft exists for that entry).
2. Updates `seo_posts.last_updated_at`.
3. Triggers `embed-blog.workflow.ts` to refresh the embedding (content may have changed).
4. Logs to `seo_webhook_events`.

### 15.2 Gruve → Pulse

Endpoint: `POST /api/webhooks/gruve`

Receives revalidation confirmations: `{ slug, revalidatedAt, tags }`. Used to flip draft status from `publishing` → `live` only after Gruve confirms cache flushed. Editors see "Live on gruve.events" only once this lands.

---

## 16. Observability and logging

- All AI calls → `ai_call_log` (already in place).
- All workflow step outcomes → `seo_publish_run_steps`.
- All webhook events → `seo_webhook_events` with `signature_ok` boolean.
- All cron job runs → `cron_runs` table with status, duration, rows processed.
- Sentry for unhandled exceptions, scoped per tenant.
- Slack `#pulse-seo-alerts` channel for:
  - Publish failures.
  - Daily DLQ summary.
  - Decay alerts.
  - AI budget threshold crossings.

Per-tenant dashboard at `/settings/ai-usage` already exists; extend with SEO module breakdown.

---

## 17. Security considerations

- **Contentful CMA tokens** stored encrypted in `tenant_integrations.encrypted_creds`. Decrypted only inside server actions and workflows. Never logged.
- **GSC/GA4 service-account JSON** same treatment.
- **Webhook signatures** verified with `crypto.timingSafeEqual`.
- **RLS on every SEO table** — only tenant members can read; only owners/admins can mutate.
- **AI output sanitization** — Rich text emitted by LLM is JSON, but `link` nodes' URLs validated against an allowlist of protocols (`https:`, `mailto:`). Embedded asset references must reference Pulse-managed asset IDs only.
- **Preview JWTs** — short-lived, JTI-tracked in Upstash Redis.
- **Pulse → Gruve API calls** — JWT signed by Pulse's private key; Gruve verifies via JWKS endpoint.
- **CMA writes attributed** to the Pulse service account; `pulseMetadata.approvedBy` carries the human approver's ID for audit.

---

## 18. Implementation roadmap

| Phase | Weeks | Deliverables |
|---|---|---|
| **0. Schema + foundations** | 1 | Migration 039; CMA client factory; gateway extension; cron infra |
| **1. Editor + draft CRUD** | 2 | `seo/drafts/[id]/page.tsx` with Tiptap; markdown↔rich-text conversion; SEO scoring panel |
| **2. Publish workflow** | 2 | `publish-blog.workflow.ts`; asset upload steps; idempotency; failure UX |
| **3. Approval state machine + audit** | 1 | Multi-stage approval; audit table; preview iframe to Gruve |
| **4. GSC + GA4 sync** | 1 | Daily crons; per-page metrics dashboard |
| **5. Decay + recommendation v1** | 2 | Decay detector; title/meta/internal-link recommendations |
| **6. Embeddings + internal linking** | 1 | pgvector; embed workflow; link suggestion engine |
| **7. Keyword tracking** | 1 | DataForSEO integration; tracked keyword UI |
| **8. Schema generators + FAQ** | 1 | FAQ from PAA; HowTo detection; JSON-LD overrides |
| **9. Outcome tracking** | 1 | 30-day rec outcome capture; recommendation quality dashboard |
| **10. Backlinks (optional)** | 2 | Ahrefs integration; outreach surfacing |
| **11. Hardening + scale** | ongoing | Cost dashboards, budget guards, DLQ triage |

Total: ~13-15 weeks for one engineer; ~8-10 weeks with two engineers split across UI and pipeline.

---

## 19. MVP vs enterprise

**MVP (must-ship for Pulse v1 SEO):**

- Drafts + editor + approval (Phases 0-3).
- Publish workflow with retries (single-step retry acceptable for MVP; can defer durable workflow if engineering capacity is tight).
- GSC daily sync + basic per-post metrics.
- Three recommendation types: title rewrite, internal link, decay alert.

**Enterprise:**

- Durable workflows everywhere.
- Multi-stage approval.
- Full recommendation engine with outcome tracking.
- Embeddings + internal link graph.
- Keyword tracking via paid SERP API.
- Backlink intelligence.
- A/B testing for titles/metas.
- Per-tenant AI budget enforcement.
- Multi-locale generation.

---

## 20. Production risks

- **AI quality regression** — model upgrades change output style. Mitigation: lock prompt+model version per `pulse_metadata.prompt_version`; canary new versions on 5% of drafts before global rollout.
- **Google helpful-content penalties** — AI farm risk. Mitigation: editor-in-the-loop, original data per post, E-E-A-T (author bios, `sameAs` schema).
- **CMA rate limits** — bulk publishes throttled. Mitigation: token-bucket queue producer.
- **Embedding drift** — model retirement breaks vector comparability. Mitigation: store model name + version per embedding row; re-embed on model change.
- **Recommendation slop** — bad recommendations erode editor trust. Mitigation: outcome tracking + retire rec types whose 30-day outcome is neutral or negative.
- **GSC data lag (2-3 days)** — decay detection always lagging. Mitigation: layer GA4 daily signal for faster trending.
- **Vendor lock-in to Contentful** — high; mitigated by keeping Pulse's draft schema CMS-agnostic and `map-payload.ts` as the only Contentful-specific transformer.

---

## 21. Engineering complexity analysis

| Component | Complexity | Risk |
|---|---|---|
| AI brief→draft generation | Medium | Medium — prompt engineering iteration |
| SEO scoring agent | Medium | Low |
| Tiptap editor with SEO panel | Medium | Low |
| Approval state machine | Low | Low |
| Durable publish workflow | High | Medium — distributed failure modes |
| Asset upload + processing | Medium | Medium — Contentful async processing quirks |
| Markdown → Rich Text fidelity | High | High — most "ugly blog" bugs originate here |
| GSC/GA4 daily sync | Low | Low |
| Decay detection (statistical) | Low | Low |
| Embeddings + pgvector search | Medium | Low |
| Internal link suggestion | Medium | Low |
| Keyword tracking with paid SERP | Medium | Medium — cost |
| Schema generation | Low | Low |
| Recommendation outcome loop | High | Medium — attribution noise |
| Multi-locale generation | High | High — quality parity |
| A/B testing titles in production | High | High — SEO interaction effects |

---

## 22. Suggested tech stack (consolidated)

| Layer | Pick |
|---|---|
| Runtime | Next.js 16 (Pulse), Node.js 24 |
| DB | Supabase Postgres + RLS |
| Vector | pgvector, HNSW index |
| Cache | Upstash Redis |
| Queues | Vercel Queues |
| Workflows | Vercel Workflow DevKit |
| AI long-form | Claude Opus 4.7 |
| AI scoring/batch | GPT-4.1 mini |
| Embeddings | OpenAI `text-embedding-3-large` |
| AI orchestration | Vercel AI SDK v6 + existing `gateway.ts` |
| CMS | Contentful (CMA, CDA, CPA, GraphQL) |
| Analytics | GSC API, GA4 Data API, optionally DataForSEO, Ahrefs |
| Warehouse | Supabase initially; Postgres partitioning until volume forces ClickHouse |
| Observability | Sentry + Vercel Observability + custom `ai_call_log` |
| Editor | Tiptap (existing) + custom SEO panel |
| Auth | Supabase Auth (existing) |
| Email | Brevo (existing) |
| Notifications | Slack webhooks |

---

## 23. Closing notes for engineers

- The single highest-leverage piece is **the publish workflow being durable and idempotent**. Get this right before anything else; everything downstream rests on it.
- The **recommendation outcome loop** is the moat. Don't ship recommendations without the 30-day outcome capture from day one — retrofitting it later means losing months of signal.
- **Quality gates** matter more than volume. Track approval rate (drafts approved / drafts generated) as a north-star KPI; if it drops below 70%, stop scaling generation and fix the prompt/model first.
- Pulse generation × Gruve rendering × analytics writeback is a **closed-loop system**. Each leg is testable in isolation, but the loop only proves its value when all three are wired and a recommendation can be measured end-to-end. Plan the first end-to-end test of a real recommendation as a milestone, not an afterthought.
