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
- **`seo_post_embeddings`** (046): pgvector(3072), keyed `(tenant_slug, slug)`.
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
- **Generation logic** per rec type (scoring thresholds, internal-link
  candidate selection from `seo_post_embeddings` + `seo_internal_links`, decay
  detection) — _(inferred skeleton; exact rubrics **[GRUVE-PENDING]** pending
  the original spec §13–§16 if/when supplied; defaults documented in code)._

## §10 Embeddings & internal linking

`src/lib/vector/embed.ts` → `embedSeoPost(post)`: `text-embedding-3-large` @
3072 dims, **on publish only** (not per editor save), `content_hash` =
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
`contentType: "blog" | "story"`. Editor preview pane iframes
`https://gruve.events/api/preview?token=<jwt>&slug=<slug>`. **Acceptance M2.**

## §14 Beacon receiver

`POST /api/seo/beacon`: verify `Authorization: Bearer PULSE_BEACON_SECRET`,
persist raw payload to `seo_webhook_events` (source `gruve-beacon`), respond
202. Normalization into post metrics feeds §9 outcome capture. Payload schema
**[GRUVE-PENDING]** (wire contract C4) — receiver + auth + raw persistence ship
now; the parser lands when C4 is supplied.

## §15 Gruve data reads

Pulse calls Gruve's Pulse-facing APIs with a JWT signed by Pulse's **RS256**
private key; Pulse hosts JWKS at
`https://pulse.gruve.events/.well-known/jwks.json`. The set of endpoints
(names, paths, params — wire contract C5) is **[GRUVE-PENDING]**. A typed client
interface is stubbed; implementations land when C5 is supplied.

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

## Open cross-repo items ([GRUVE-PENDING])

1. Wire contract **C4** — beacon payload schema (§14).
2. Wire contract **C5** — the 6 Gruve Pulse-facing API contracts (§15).
3. Env/creds: `CONTENTFUL_CMA_TOKEN`, Contentful **CDA delivery token**,
   `PREVIEW_SHARED_SECRET`, `PULSE_BEACON_SECRET`, Pulse RS256 private key +
   JWKS hosting.
4. Confirm `seo-longform` model (gpt-5 vs claude-opus-4-7) and the
   `author_image → authorImage` map line (§5).
5. Recommendation generation rubrics §9 (original spec §13–§16 if available).
