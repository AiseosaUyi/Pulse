# PULSE-SEO-SPEC.md — AI SEO Operating System

> Status: **authoritative working spec**, reconstructed in the Pulse repo from
> the implementation brief, the inline Contentful/idempotency corrections, and
> the already-built data layer (migrations 043–047 + `src/lib/ai/seo/`). Where a
> value was supplied verbatim in the brief it is **normative**; where it was
> inferred from the schema it is marked _(inferred)_; cross-repo contracts not
> yet supplied are marked **[GRUVE-PENDING]** and must be confirmed by the Gruve
> team before the dependent phase ships.

---

## §1 Purpose

Pulse becomes the SEO operating system for Gruve's blog: it drafts and scores
long-form posts, runs them through a review→publish lifecycle, pushes the
approved entry into Gruve's Contentful (`gruveBlog`, space `nc7eiymdfagh`),
lets editors preview the live Gruve render before publish, ingests post-publish
performance back via a beacon, and runs a recommendation engine whose
**30-day outcome capture is the moat** (we keep the before/after of every
applied recommendation so rec types can be evaluated, not guessed).

## §2 Scope & non-goals

In scope: draft generation, deterministic SEO scoring, approval state machine,
Contentful publish workflow, preview, embeddings for internal-link suggestions,
recommendation engine + outcome capture, cron observability.

Non-goals: Pulse does not render the public blog (Gruve does), does not own
Contentful's content model evolution beyond the additive Pulse fields
(Appendix C), and does not call Gruve's revalidation directly (Gruve's own
Contentful webhook handles it).

---

## §3 Architecture & reconciliation

**Draft store = `blog_posts`** (the production blog editor's backing table,
migration 015), extended by migrations 043–047 — *not* a standalone
`seo_drafts` table. Rationale: the brief's standalone design assumed a clean
slate at migration 042; the repo already contained a coherent `blog_posts`-
extension implementation of this exact lifecycle. The naming difference is
bridged by **`gruveBlog.pulseId = blog_posts.id`** (string form of the UUID).

Reused, never duplicated (confirmed file:line):

| Concern | Surface |
|---|---|
| AI telemetry | `logAiCall` — `src/lib/ai/gateway.ts:128`; `ai_call_log` (mig 012/023) |
| Model routing | `getModel/getModelId/estimateCostUsd` + `Purpose` — `gateway.ts:15-110` |
| Brand context | `getBrandContext`/`buildPositioningBlock` — `brand-positioning.ts:84,99` |
| Budget gate | `checkAiBudget` + `BudgetExceededError` — `ai-budget.ts:111` |
| RLS helpers | `is_tenant_member`/`tenant_role` — `002_foundation.sql:74,87` |
| Auth | `requireUser`/`getCurrentTenant` — `src/lib/auth.ts` |
| Cron gate | `verifyFromRequest` — `src/lib/cron/auth.ts:75` |
| Briefs feed | `content_briefs` → `blog_posts.brief_id` |

## §4 Data model

Defined by migrations 043–047 (already in tree) plus the additive top-up in
migration 048 (this spec, §11).

- **`blog_posts`** (043): lifecycle status, `version` (optimistic lock),
  `body_rich_text`, `cover_image`, `inline_images`, `seo_meta_title/description`,
  `canonical_override`, `json_ld_blocks`, `scheduled_at`, `published_at`,
  `contentful_entry_id`, `contentful_version`, `seo_score`, `last_error`,
  `publish_run_id`, `brief_id`. **048 adds**: `slug`, `excerpt`, `author`,
  `author_image`, `thumbnail`, `read_minutes`, `faq_items`, `json_ld_overrides`,
  `pulse_metadata` (the fields the `gruveBlog` map needs that 043 lacks).
- **`seo_publish_runs` / `seo_publish_run_steps`** (044): durable publish
  workflow; one step row per `(run_id, step, attempt)`.
- **`seo_post_status_audit`** (044): every status transition, actor, reason.
- **`seo_recommendations`** (045): rec lifecycle + `baseline_30d` /
  `outcome_30d` / `outcome_due_at` (the moat columns — present from day one).
- **`seo_internal_links`** (045): observed from→to anchor graph.
- **`seo_webhook_events`** (045): raw inbound (Contentful confirms, beacons).
- **`seo_post_embeddings`** (046): pgvector(1536) — pgvector HNSW caps at
  2000 dims so 3072 is impossible; keyed `(tenant_slug, slug)`.
- **`seo_posts`** (046): lightweight published-content projection.
- **`cron_runs`** (047): one row per cron invocation.
- **`seo_preview_jti`** (048, this spec §11): jti replay cache, 5-min TTL.

## §5 Contentful mapping (overrides any prior §5.4)

Content type **`gruveBlog`**, space `nc7eiymdfagh`, env `master`. RichText field
is **`content`** (not `body`). Normative map:

| Pulse (`blog_posts`) | `gruveBlog` field | Contentful type |
|---|---|---|
| `title` | `title` | Symbol |
| `slug` | `slug` | Symbol (unique) |
| `excerpt` | `description` | Text |
| `body_rich_text` | `content` | RichText |
| `cover_image` | `bannerImage` | Asset link |
| `thumbnail` | `thumbnail` | Asset link |
| `read_minutes` | `minuteRead` | Integer |
| `author` | `author` | Symbol |
| `author_image` | `authorImage` | Asset link |
| `seo_meta_title` | `seoTitle` | Symbol *(added by Appendix C)* |
| `seo_meta_description` | `seoDescription` | Symbol *(added)* |
| `canonical_override` | `canonicalUrl` | Symbol *(added)* |
| `faq_items` | `faqItems` | Object *(added)* |
| `json_ld_overrides` | `jsonLd` | Object *(added)* |
| `blog_posts.id` | `pulseId` | Symbol, indexed, unique *(added — idempotency key)* |
| `pulse_metadata` | `pulseMetadata` | Object, omitted/hidden *(added)* |

The 7 *(added)* fields are created idempotently by the Appendix C CMA migration
(`scripts/migrate-contentful-model.ts`), a Phase 0 prerequisite.

## §6 Idempotency

Two-layer, both required:

1. **CMA `unique: true`** validation on `gruveBlog.pulseId` (set by the
   Appendix C migration) — backstop only; not enforced cross-environment.
2. **CDA lookup before create-vs-update**: in the publish workflow query
   `gruveBlogCollection(where: { pulseId: "<blog_posts.id>" }, limit: 1)`. If an
   entry returns → **update** that entry id; else → **create**. This lookup is
   the real guard.

Workflow run idempotency key: **`${blogPostId}:${version}`**. Re-running a
failed run at the same version is safe (every step is idempotent).

## §7 Approval state machine

Backed by `transition_blog_post_status` RPC (044): optimistic version check +
audit insert in one transaction. Callers pass `expectedVersion`; a
`version_conflict` surfaces a refresh prompt. Transitions (mirrors
`blog_posts_status_check`):

```
draft ─submit→ in_review ─approve→ seo_approved ─schedule→ scheduled
  ▲                │                                          │
  └─request_changes┘                                  ─publish→ publishing
seo_approved ─publish→ publishing ─success→ published ─archive→ archived
publishing ─fail→ publish_failed ─retry→ publishing
publish_failed ─give_up→ draft
```

Server actions live in `src/lib/actions/seo-approvals.ts` (already built):
`submitForReview`, `approvePost`, `requestChanges`, `schedulePost`,
`retryPublish`, `unpublishToDraft`, `archivePost`.

## §8 Draft generation & scoring

- **Generation** (`src/lib/ai/seo/generate-seo-blog.ts`, built):
  `checkAiBudget` → parallel `getBrandContext` + SERP snapshot → `generateText`
  strict structured output (`seoBlogSchema`, `.nullable()` convention) →
  `logAiCall` purpose `seo-longform`, feature `seo_blog_generate`. Triggerable
  from a keyword or a `content_briefs` row (via `blog_posts.brief_id`).
- **Scoring** (`src/lib/ai/seo/score-seo-extras.ts`, built): deterministic,
  zero AI cost. 7 gauges — metaTitle, metaDescription, lengthVsSerp, imageAlts,
  internalLinks, externalAuthority, jsonLd — rendered by
  `src/components/seo/blog/SeoPanel.tsx` live in the editor.

## §9 Recommendation engine

Lifecycle: `generated → surfaced → (applied | dismissed | snoozed) →
measured_30d`. Rec `type` ∈ {`title_rewrite`, `meta_rewrite`,
`internal_link_add`, `internal_link_receive`, `faq_add`, `schema_add`,
`content_refresh`, `keyword_capture`, `decay_alert`, `backlink_outreach`}.

- **Outcome capture (the moat, ship day one — do NOT retrofit):** on `applied`,
  snapshot `baseline_30d` (the post's prior-30-day metrics) and set
  `outcome_due_at = now() + 30d`. A daily cron captures `outcome_30d` once
  `outcome_due_at` passes. This wiring is built in Phase 8 regardless of whether
  generation logic is finalized.
- **Generation status** per rec type:
  - ✅ Deterministic (live, from `scoreSeoExtras`): `meta_rewrite`,
    `content_refresh`, `internal_link_add`, `schema_add`, `faq_add`.
  - ✅ `decay_alert` — Pack C §10 implemented (`detect-decay.ts`,
    `seo-decay-detect` cron 08:00 UTC): `decay = 1 - MA30/MA90` (mean
    daily clicks), flag if `> 0.25` and 90-day clicks `> 50`. Clicks via
    C5 engagement → beacon rollup. SERP-confirmation (Pack C §10.4) is a
    non-gating enhancement (`serp_confirmed:false`) — no publish-date
    SERP snapshot store yet.
  - ⛔ `keyword_capture` — needs Pack C §7 **Google Search Console API**
    (impressions/position per query). No GSC connector in Pulse —
    blocked on a new data source, not logic.
  - ⛔ `backlink_outreach` — needs **Ahrefs** backlink-intersection.
    No Ahrefs connector — blocked on a new data source.
  - `title_rewrite`/`internal_link_receive` — covered by `meta_rewrite`/
    `internal_link_add` paths; distinct emitters deferred.
  - §4.2 composite 0–100 weights arrived garbled in transit; deterministic
    confidence (0.85 bad / 0.55 warn) stands until the clean full Pack C
    `PULSE-SEO-SPEC.md` is received.

## §10 Embeddings & internal linking

`src/lib/vector/embed.ts` → `embedSeoPost(post)`: `text-embedding-3-large` @
1536 dims (pgvector HNSW 2000-dim ceiling), **on publish only** (not per
editor save), `content_hash` =
sha256(normalized body) for staleness, upsert `seo_post_embeddings`, `logAiCall`
purpose `seo-embedding`. Internal-link recs use cosine-nearest published posts
(HNSW index in 046) filtered against the observed `seo_internal_links` graph.

## §11 Migration 048 (additive top-up)

Grep prior migrations for collisions first (project rule). Add: the 9
`blog_posts` columns in §5 not already in 043; `seo_preview_jti(jti text pk,
expires_at timestamptz)` + sweep index; RLS on new tables via the
`013_trend_scouts.sql:37-42` template.

## §12 Publish workflow

`src/lib/seo/publish-runner.ts` drives the step graph in 044:

```
load_post → upload_cover → upload_inline_assets → upsert_entry
  → publish_entry → notify_gruve → write_post_index → embed → mark_published
```

Each step checkpoints into `seo_publish_run_steps`; resume = restart at the step
after `max(step where status='ok')`. **`notify_gruve` = the Contentful
`publishEntry` call itself** — Gruve's own Contentful webhook performs
revalidation; Pulse does **not** call `/api/revalidate`. `write_post_index`
upserts `seo_posts`; `embed` invokes §10. Triggered by a cron sweeping due
`scheduled` posts and by `retryPublish`. Not Vercel Workflow DevKit:
DB-checkpoint/resume is the deliberate choice (044 comment); revisit after 100
publishes.

## §13 Preview

`src/lib/seo/preview-token.ts` mints **HS256** JWT: secret
`PREVIEW_SHARED_SECRET`, `iss:"pulse"`, `aud:"gruve-preview"`, `exp: 60s`,
random `jti` recorded in `seo_preview_jti` (rejected on replay within 5 min),
`contentType: "blog"` (Gruve confirmed; send `"blog"`). Editor preview pane
iframes `https://www.gruve.events/api/preview?token=<jwt>&slug=<slug>`. Gruve
verifies HS256 (alg-pinned), checks the token's own `exp` (no cap — keep ≈60s),
and does **not** enforce single-use `jti` (no Redis their side) so our
`seo_preview_jti` ledger is advisory only. Gruve sends
`CSP: frame-ancestors 'self' https://pulse-ashy-kappa.vercel.app` and no
`X-Frame-Options`. **Acceptance M2.**

## §14 Beacon receiver — C4 RESOLVED

`POST /api/seo/beacon`: verify `Authorization: Bearer PULSE_BEACON_SECRET`,
persist the envelope to `seo_webhook_events` (source `gruve-beacon`), 202. The
`seo-beacon-process` cron normalizes it. **C4 envelope (fixed):**
`{ receivedAt, ipTrunc, country, ua, events:[{ name, occurredAt, sessionId,
slug?, payload }] }` — events join to posts by **`slug`** (no pulseId at beacon
time); tenant resolved via `blog_posts.slug`. Event set:
`blog_view` · `blog_scroll{depth}` · `blog_dwell{msActive}` · `blog_outbound` ·
`blog_internal_link` · `blog_share` · `blog_cta_click` · `web_vitals`. Rolled
up per `(tenant,slug,date)` into `seo_post_engagement_daily` (mig 049);
`web_vitals` kept raw only. Revalidation is Gruve's Contentful webhook
(`/api/revalidate`, HMAC) — Pulse never calls it.

## §15 Gruve data reads — C5 RESOLVED

Base `https://www.gruve.events`. Pulse signs an **RS256** JWT
(`iss:"pulse"`, `aud:"gruve-api"`); Gruve verifies via our JWKS at
`https://pulse-ashy-kappa.vercel.app/.well-known/jwks.json`. Six endpoints
implemented in `gruve-client.ts`: `GET /api/pulse/engagement`, `/conversions`,
`/crawlers`, `/events-traffic`, `/internal-link-graph`, `POST /api/pulse/reindex`.
Cursor-paginated (ISO date), 60 req/min/token. Dormant (`{data:[]}`, auth still
enforced) until Gruve provisions its analytics DB — callers degrade gracefully;
`snapshotPostMetrics` falls back C5 → beacon rollup → GA4.

## §16 Cron observability

`withCronRun(jobName, fn)` writes one `cron_runs` row per invocation
(`running → ok | partial | failed | skipped`, `rows_processed`, `error`,
`metadata`). All SEO crons (publish sweep, outcome capture, preview-jti sweep,
internal-link crawler) and existing crons are wrapped.

## §17 Gateway / models

`Purpose` already extended: `seo-longform` → `openai("gpt-5")` (the brief's
"claude-opus-4-7" was garbled and would need `@ai-sdk/anthropic`, not
installed — flagged for override), `seo-scoring` → `gpt-4o-mini`,
`seo-embedding` → `text-embedding-3-large`, vision → `gpt-4o`. **Every** AI
call `logAiCall`s (success and failure).

## §18 Acceptance milestones

- **M2** — preview renders on Gruve from a Pulse-minted token (§13).
- **M4** — one real recommendation applied → republished →
  `outcome_30d` captured (§9; outcome capture built day one, not retrofit).
- Commit per phase.

---

## Appendix C — Contentful CMA migration

`scripts/migrate-contentful-model.ts` (in repo). Idempotent; adds the 7
*(added)* fields in §5 to `gruveBlog`. Run as a Phase 0 prerequisite:
`pnpm tsx scripts/migrate-contentful-model.ts` with `CONTENTFUL_CMA_TOKEN` +
`CONTENTFUL_SPACE_ID=nc7eiymdfagh`. Publishes a content-type change to Gruve
production — requires the Gruve lead's go-ahead before running.

## Open cross-repo items

- ✅ **C4** (beacon schema) — RESOLVED, wired (§14).
- ✅ **C5** (6 Gruve APIs) — RESOLVED, implemented; dormant until Gruve's
  analytics DB is provisioned (§15).
- ✅ Preview framing, claims, contentType, revalidation — confirmed (§13).
- ⏳ **Gruve ops** (not Pulse code): mint Contentful **CMA token** → run
  Appendix C script; configure Contentful webhook → `/api/revalidate` +
  `CONTENTFUL_WEBHOOK_SECRET`; set `PULSE_BEACON_URL`/`PULSE_JWKS_URL`.
- ⏳ **Pulse ops**: set env (`CONTENTFUL_*`, `PREVIEW_SHARED_SECRET`,
  `PULSE_BEACON_SECRET`, `PULSE_JWKS_PRIVATE_KEY`/`KID`); share the two
  generated secrets with Gruve securely.
- ⏳ Advanced rec rubrics §9 (`keyword_capture`/`backlink_outreach`/
  `decay_alert`) — still need original spec §13–§16; deterministic
  baseline already shipped.
- `seo-longform` = OpenAI `gpt-5` (decision stands).
