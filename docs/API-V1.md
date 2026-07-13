# Pulse `/api/v1` API

A versioned, scoped, token-authenticated REST API for driving Pulse server-to-server —
built for external AI "operator" skills (Cowork: `pulse-sales`, `pulse-content`, `pulse-seo`,
`pulse-social`, `pulse-analyst`) that can't use the cookie/session Server Actions the web app
uses. Wraps the existing service/action layer; no business logic is duplicated.

Separate from `/api/ext/*` (the Chrome extension's endpoint set) — that surface is unscoped
and untouched by this work. `/api/v1` is additive.

## Base URL

```
https://<your-vercel-domain>/api/v1
```

## Authentication

Every request needs `Authorization: Bearer pulse_ext_<hex>`.

Mint a token at **Settings → Integrations → API tokens** (owner/admin only). Pick the scopes
the token needs — default is all `*:read` scopes across every module. A token minted before
this API existed (`scope='extension'`) was auto-upgraded to full `/api/v1` access by migration
088, so nothing needs re-minting for pre-existing tokens.

Missing/invalid/revoked token → `401 {"error": "Unauthorized"}`.
Valid token, missing scope → `403 {"error": "Missing required scope: <scope>"}`.
Over the rate limit (60 req/min per token) → `429 {"error": "Rate limit exceeded"}` with a
`Retry-After` header.

## Scopes

Comma-separated on the token; `admin` implies every scope.

| Scope | Grants |
|---|---|
| `sales:read` / `sales:write` | Prospects, DMs, outbound templates/filters, follow-ups, event leads |
| `content:read` / `content:write` | Briefs, content calendar, blog posts, captions |
| `seo:read` / `seo:write` | SEO recommendations, rank tracking, topical map (`seo:write` is reserved — no write endpoint exists yet) |
| `intel:read` | Intel feed, trends, competitors |
| `analytics:read` | Analytics overview, per-post insights, weekly review |
| `publish:read` / `publish:write` | Publish queue, media, recording published posts + metrics |
| `engage:read` / `engage:write` | Inbox, reply drafts, marking replies handled |
| `admin` | Everything above |

## Conventions

- All responses are JSON, `camelCase` keys.
- Errors: `{"error": "message"}`, or `{"error": "message", "issues": [...]}` for a 400 Zod
  validation failure. Never leaks stack traces.
- List endpoints paginate via `?limit=` (default 25, max 100) and `?offset=`, responding
  `{"data": [...], "nextCursor": "<next offset>" | null}`.
- `OPTIONS` is supported on every route for CORS preflight.

## Self-discovery

```
GET /api/v1/manifest
```

Returns `{"version": "v1", "endpoints": [{method, path, scope, description}, ...]}` —
generated from a single source of truth (`src/lib/api/manifest.ts`) so it can't drift from
the real routes. A skill can call this once to learn what's available without hardcoding it.

## Endpoints

### Meta

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/me` | any valid token | Resolve the token to its tenant, brand voice/positioning, and granted scopes. |
| GET | `/api/v1/manifest` | any valid token | Machine-readable endpoint list (see above). |

**`GET /api/v1/me`** — example response:

```json
{
  "tenant": { "slug": "gruve", "name": "Gruve" },
  "brandVoice": { "...": "..." },
  "positioning": { "...": "..." },
  "scopes": ["sales:read", "sales:write"]
}
```

### Sales / outbound

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/prospects` | `sales:read` | List/filter prospects. |
| POST | `/api/v1/prospects` | `sales:write` | Upsert a prospect by `(platform, handle)`. |
| GET | `/api/v1/prospects/:id` | `sales:read` | Single prospect + full conversation thread. |
| POST | `/api/v1/prospects/:id/draft-dm` | `sales:write` | AI-draft an outbound DM and save it. |
| POST | `/api/v1/dms/:id/sent` | `sales:write` | Mark a drafted DM sent; cascades prospect status. |
| GET | `/api/v1/outbound/templates` | `sales:read` | List outbound templates (tenant + global). |
| GET | `/api/v1/outbound/filters` | `sales:read` | The tenant's discovery filters. |
| POST | `/api/v1/event-leads` | `sales:write` | Capture an event/organizer lead. |
| GET | `/api/v1/follow-ups` | `sales:read` | Today's outreach queue. |
| POST | `/api/v1/prospects/:id/notes` | `sales:write` | Log a note on a prospect. |
| POST | `/api/v1/prospects/:id/stage` | `sales:write` | Transition pipeline status, with a reason. |
| POST | `/api/v1/prospects/:id/inbound` | `sales:write` | Record an inbound reply observed on-platform. |

**`GET /api/v1/prospects?status=qualified&platform=instagram&qualificationScoreMin=70&search=lagos&limit=25&offset=0`**

```json
{
  "data": [
    {
      "id": "...",
      "tenantSlug": "gruve",
      "platform": "instagram",
      "handle": "lagos_events_co",
      "status": "qualified",
      "qualificationScore": 82,
      "qualificationReason": "Lagos event organizer · runs paid ticketed events monthly",
      "...": "..."
    }
  ],
  "nextCursor": null
}
```

**`POST /api/v1/prospects`**

```json
// request
{ "platform": "instagram", "handle": "@lagos_events_co", "displayName": "Lagos Events Co" }
// response
{ "prospect": { "...": "..." }, "dm": null }
```

**`GET /api/v1/prospects/:id`** — the prospect plus a merged, time-sorted thread of every
outbound DM, inbound message, note, and AI conversation analysis:

```json
{
  "prospect": { "...": "..." },
  "thread": [
    { "id": "...", "type": "outbound_dm", "createdAt": "...", "dmBody": "...", "dmStatus": "sent", "dmVersion": 1 },
    { "id": "...", "type": "inbound_message", "createdAt": "...", "messageBody": "..." },
    { "id": "...", "type": "note", "createdAt": "...", "noteBody": "..." },
    { "id": "...", "type": "analysis", "createdAt": "...", "analysis": { "...": "..." } }
  ]
}
```

**`POST /api/v1/prospects/:id/draft-dm`**

```json
// request
{ "context": "They just posted about hosting a 500-person conference in March" }
// response
{ "prospect": { "...": "status: drafted" }, "dm": { "id": "...", "body": "...", "followupBody": "..." }, "rationale": "..." }
```

**`POST /api/v1/prospects/:id/stage`**

```json
{ "status": "closed_lost", "reason": "Went with a competitor after 3 follow-ups" }
```

`status` must be one of the `ProspectStatus` enum values: `new`, `qualifying`, `qualified`,
`unqualified`, `drafted`, `approved`, `sent`, `replied`, `handed_off`, `closed_won`,
`closed_lost`, `dismissed`.

**`POST /api/v1/prospects/:id/inbound`**

```json
{ "body": "Interesting, tell me more about pricing", "inReplyToDmId": "optional-dm-uuid" }
```

**`POST /api/v1/event-leads`**

```json
{
  "platformId": "clooza",
  "pageUrl": "https://clooza.com/events/afrobeats-night",
  "eventTitle": "Afrobeats Night",
  "organizerName": "Afrobeats Night Ltd",
  "priceRaw": "₦5,000"
}
```

`platformId` must be one of the platforms the scraper knows how to resolve socials for
today: `clooza`, `tickethub`, `eventpadi`, `eventporte`, `tixvnt`.

**`GET /api/v1/follow-ups`**

```json
{
  "overdue": [ { "...": "prospect + followUpAt + followUpNote + latestAnalysis" } ],
  "dueToday": [ "..." ],
  "newReplies": [ { "id": "...", "prospectId": "...", "body": "...", "receivedAt": "...", "prospect": { "...": "..." } } ],
  "goingCold": [ "..." ]
}
```

### Publishing

Closes the loop for the browser-driven social manager: direct API posting to X/LinkedIn/TikTok
is intentionally not used (cost), so `pulse-social` fetches what to post here, posts through a
real browser, then writes back what happened.

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/publish-queue` | `publish:read` | Scheduled posts awaiting manual publishing. |
| GET | `/api/v1/media/*path` | `publish:read` | Resolve an R2 media key to a downloadable URL. |
| POST | `/api/v1/posts/:id/published` | `publish:write` | Record a successful manual post. |
| POST | `/api/v1/posts/:id/metrics` | `publish:write` | Record engagement observed on-platform. |

**`GET /api/v1/publish-queue?status=scheduled&platform=instagram&due=true&limit=25&offset=0`**

Defaults to `status=scheduled` (the DB's own "ready to publish" partial index). `due=true`
filters to `scheduledFor <= now`.

```json
{
  "data": [
    {
      "id": "...",
      "platform": "instagram",
      "content": "...",
      "mediaPaths": ["assets/gruve/202607/abc123.jpg"],
      "scheduledFor": "2026-07-10T14:00:00Z",
      "status": "scheduled"
    }
  ],
  "nextCursor": null
}
```

**`GET /api/v1/media/assets/gruve/202607/abc123.jpg`** — path segments after `/media/` are the
raw R2 key from a `mediaPaths` entry. Validates the key's tenant segment matches the token's
tenant (403 if not — R2 reads are public-by-URL, there's no per-object signing in this codebase,
so this check is the actual isolation boundary) and that the object exists (404 if not).

```json
{ "url": "https://media.yourdomain.com/assets/gruve/202607/abc123.jpg" }
```

**`POST /api/v1/posts/:id/published`**

```json
// request
{ "platformPostId": "17912345678", "platformPostUrl": "https://instagram.com/p/Cxxxxx" }
// response
{ "success": true }
```

409 if the post is already `published` (idempotency guard — the same shape a retry from a
flaky browser session would hit).

**`POST /api/v1/posts/:id/metrics`**

```json
{ "likes": 214, "comments": 12, "shares": 3, "observedAt": "2026-07-10T18:00:00Z" }
```

At least one of `likes`/`comments`/`shares`/`saves`/`views` is required. 400 if the post's
platform is `youtube` — `own_post_metrics.platform` doesn't have a YouTube slot yet (same gap
the `sync-post-metrics` cron already has).

### Engagement / inbox

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/inbox` | `engage:read` | Comments/DMs needing a response. |
| POST | `/api/v1/inbox/:id/reply-draft` | `engage:write` | Generate an on-brand reply draft. |
| POST | `/api/v1/inbox/:id/replied` | `engage:write` | Mark an inbox item handled. |

**`GET /api/v1/inbox?platform=instagram&unanswered=true&limit=25&offset=0`**

```json
{
  "data": [
    {
      "id": "...", "type": "comment", "platform": "instagram",
      "fromName": "...", "fromHandle": "...", "content": "...",
      "receivedAt": "...", "read": false, "replied": false,
      "sentiment": "question", "aiDraft": null, "approvalStatus": null
    }
  ],
  "nextCursor": null
}
```

**`POST /api/v1/inbox/:id/reply-draft`** — no body. Writes the draft into `ai_draft` +
`approval_status: "pending_review"` on the item (same as the in-app approval queue) and returns it:

```json
{ "draft": { "body": "...", "confidence": "high" } }
```

**`POST /api/v1/inbox/:id/replied`** — no body. `{"success": true}`, or 404 if the item isn't
found for this tenant.

### Intelligence

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/intel/feed` | `intel:read` | Competitor intel signals (filter `contentType`/`since`). |
| GET | `/api/v1/trends` | `intel:read` | Current viral/trend signals (filter `platform`/`source`). |
| GET | `/api/v1/competitors` | `intel:read` | The tenant's tracked competitor set. |

**`GET /api/v1/intel/feed?contentType=reel&since=2026-07-01T00:00:00Z&limit=25&offset=0`**

```json
{ "data": [{ "id": "...", "competitorName": "...", "platform": "instagram", "contentType": "reel", "summary": "...", "metrics": { "engagement": 120, "engagementRate": 0.04, "vsAverage": 1.8 } }], "nextCursor": null }
```

**`GET /api/v1/trends?platform=tiktok&source=hashtag_scout&limit=25&offset=0`** — same
paginated `{data, nextCursor}` shape.

**`GET /api/v1/competitors`** — a static snapshot (no computed deltas), no pagination.

### SEO

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/seo/recommendations` | `seo:read` | Open SEO recommendations, ranked by score (default `status=surfaced`). |
| GET | `/api/v1/seo/rank` | `seo:read` | Tracked-keyword ranks. |
| GET | `/api/v1/seo/topical-map` | `seo:read` | The tenant's latest generated topical map. |

**`GET /api/v1/seo/recommendations?status=surfaced&limit=25&offset=0`** — `status` is one of
`surfaced`/`applied`/`dismissed`/`snoozed`.

**`GET /api/v1/seo/rank?limit=25&offset=0`** — tracked keywords, paginated.

**`GET /api/v1/seo/topical-map`** — pre-stored, no LLM call on read (generating a fresh map costs
a real `gpt-4.1` call and isn't wired to this GET, same exclusion as `draft-dm`). 404 if the
tenant has never generated one.

### Analytics

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/analytics/overview` | `analytics:read` | Dashboard KPIs: reach/engagement this week vs last, prospect pipeline, active campaign spend, connected platforms. |
| GET | `/api/v1/analytics/posts` | `analytics:read` | Per-post engagement metrics (filter `platform`/`since`) — reads `own_post_metrics`, the same table `publish:write`'s metrics endpoint writes to. |
| GET | `/api/v1/weekly-review` | `analytics:read` | The latest generated weekly business-review narrative. |

**`GET /api/v1/analytics/overview`** — no pagination, no filters, returns the same shape the
in-app dashboard widget renders (`socialReach`, `activeLeads`, `adSpend`, `connectedPlatforms`, ...).

**`GET /api/v1/analytics/posts?platform=instagram&since=2026-07-01T00:00:00Z&limit=25&offset=0`**

**`GET /api/v1/weekly-review`** — pre-stored, no LLM call on read (generation is a separate cron).
404 if no review has been generated yet.

### Content

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1/briefs` | `content:read` | List content briefs (filter `status`). |
| POST | `/api/v1/briefs` | `content:write` | Generate a content brief from an existing intel card. |
| GET | `/api/v1/content-calendar` | `content:read` | Upcoming `content_slots` for the tenant (individual-persona feature — allowlist-gated, same as the app). |
| GET | `/api/v1/blog-posts` | `content:read` | List blog posts (filter `status`). |
| GET | `/api/v1/blog-posts/:id` | `content:read` | Single blog post + its latest saved version. |
| POST | `/api/v1/blog-posts` | `content:write` | Create a draft blog post (title and/or targetKeyword and/or extraContext — at least one required). AI-generated. |
| POST | `/api/v1/captions/compose` | `content:write` | AI-compose a multi-platform caption take from a source URL or angle. |

**`GET /api/v1/briefs?status=draft&limit=25&offset=0`** — `status` is one of
`draft`/`approved`/`published`/`dismissed`.

**`POST /api/v1/briefs`**

```json
// request
{ "cardId": "<intel_cards.id>" }
// response
{ "briefId": "..." }
```

404 if `cardId` doesn't resolve to a real intel card for this tenant. Real `gpt-5` call — not free.

**`GET /api/v1/content-calendar`** — 404 for any tenant not on the `content_slots` allowlist
(currently a single dogfood tenant — see `src/lib/content-calendar/tenant-config.ts`), same as the
in-app page would show.

**`GET /api/v1/blog-posts/:id`**

```json
{ "post": { "id": "...", "title": "...", "status": "draft", "content": "...", "wordCount": 812 }, "latestVersion": null }
```

**`POST /api/v1/blog-posts`**

```json
// request — at least one of title/targetKeyword/extraContext required
{ "title": "Why event ticketing platforms are broken", "targetWordCount": 1200 }
// response
{ "postId": "...", "wordCount": 1180, "targetWordCount": 1200, "wordCountWarning": false, "contentScore": 78, "scoreWarning": false }
```

Real multi-pass `gpt-4.1` generation — not free, not fast.

**`POST /api/v1/captions/compose`**

```json
// request — sourceUrl or angle required
{ "mode": "original", "angle": "our take on the ticketing platform outage today" }
// response
{ "draft": { "id": "...", "mode": "original", "x": "...", "linkedin": "...", "instagram": "...", "tiktok": "...", "youtube": "...", "hooks": ["...", "...", "..."] } }
```

Real `gpt-4.1` call — not free.

### Notifications / mobile approvals (Part 3)

Lets a founder/manager approve, edit, or reject a scheduled post or content brief from their
phone — reached via a signed, one-time link delivered by email or WhatsApp, no login required.
Approving a scheduled post is what actually triggers "auto-publish": the target row is created
with `status='draft'` (invisible to the due-post query, which only ever selects `status='scheduled'`)
and promoted to `scheduled` — with an immediate QStash enqueue if it's already due, or the normal
`notBefore`-delayed enqueue otherwise — only once approved. Rejecting sets `status='failed'` with
a `Rejected via approval link: <reason>` error message, the same convention `cancelScheduledPost`
already uses. Approving/rejecting a brief just transitions `content_briefs.status` the same way
the in-app buttons do (`approved` / `dismissed` with a reason).

| Method | Path | Scope | Description |
|---|---|---|---|
| POST | `/api/v1/briefings/send` | `publish:write` (scheduled_post) or `content:write` (content_brief) | Create an approval request for a target and deliver its link. |
| GET | `/api/v1/approvals/pending` | `content:read` | Approval requests sent but not yet approved/rejected/expired. |
| POST | `/api/v1/approvals/:token/approve` | none — the token itself is the auth | Approve, optionally with edited content. |
| POST | `/api/v1/approvals/:token/reject` | none — the token itself is the auth | Reject, optionally with a reason. |

**`POST /api/v1/briefings/send`**

```json
// request
{ "targetType": "scheduled_post", "targetId": "<scheduled_posts.id>", "deliveredVia": "email", "deliveredTo": "founder@example.com" }
// response
{ "requestId": "...", "expiresAt": "2026-07-13T12:00:00.000Z" }
```

404 if the target doesn't exist for this tenant. 502 if the request row was created but delivery
(Brevo/WhatsApp) failed — the row still exists (so it can be retried or inspected), only the send
failed. Links expire after 72 hours and work once — the `approval_requests` row's own `status`
column is the one-time-use gate (no separate replay ledger).

**`POST /api/v1/approvals/:token/approve`** — `{"editedContent"?: "..."}`. Returns
`{"target": {...the post or brief's row after the transition...}}`. 410 if the link expired, 409
if it was already actioned (by anyone — a second tap on the same link, or a race between two
people opening it).

**`POST /api/v1/approvals/:token/reject`** — `{"reason"?: "..."}`. Same response/error shape as
approve.

**The page itself** lives at `/approve/[token]` (not under `(app)`, no sidebar, no session —
exempted from the proxy auth gate via `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts`, same
mechanism as `/invite/[token]`). Server component resolves the token + renders one of: the
interactive approve/edit/reject card, or a terminal state (expired / invalid / already
approved / already rejected, the last two showing a read-only copy of what was decided).

**Env vars this group needs:** `APPROVAL_TOKEN_SECRET` (HS256 signing secret for approval links —
`POST /briefings/send` 503s without it) and, only if WhatsApp delivery is used,
`WHATSAPP_APPROVAL_TEMPLATE_NAME` (a Meta-approved WhatsApp template name with one body
placeholder for the link — proactive WhatsApp messages outside the 24h customer-service window
require a template, plain text isn't deliverable).

## Not yet shipped

Every endpoint group in the original build spec — Sales, Publishing, Engagement, Content, SEO,
Intelligence, Analytics, and Notifications/mobile approvals — has shipped. `GET /api/v1/manifest`
is the source of truth for what's actually live at any given time — check it rather than trusting
this doc's endpoint table to be current.

## Deviations from the original build spec

1. **Telemetry** isn't written to `ai_call_log` — that table is AI-cost-specific
   (tokens/model/purpose columns) and reusing it for generic API request logs would pollute
   the `/settings/ai-usage` cost view. `requireApiContext()` instead emits a structured
   `console.log` line (`{tokenId, route, status}`) on every auth decision. A dedicated,
   table-backed API call log is a reasonable follow-up once there's real usage to observe.
2. **Rate limiting** is an in-memory fixed window (60 req/min/token) — a soft limit, not
   durable across concurrent Vercel instances or cold starts. `src/lib/api/rate-limit.ts` has
   a `// TODO` for an Upstash-backed version.
3. **Legacy token scopes**: existing `scope='extension'` tokens were auto-upgraded to the full
   `/api/v1` scope list by migration 088, rather than being locked out of `/api/v1` until
   re-minted. `/api/ext/*` behavior is identical either way since it never checked scope.
4. **`getTenant()` / `getBrandContext()` weren't refactored for client injection** — `getTenant`
   has ~30 call sites across the app, too invasive for this PR. Routes that need the tenant's
   name (`/me`, `draft-dm`) run a thin admin-scoped query directly instead, per the spec's own
   fallback for over-invasive refactors. `getBrandContext`/`getBrandVoice`/`getBrandPositioning`
   already use the admin client internally, so no change was needed there.
5. **`updateProspectStatus` / `recordInboundReply`** (the existing `"use server"` actions) keep
   their original signatures rather than taking a leading `client` param — Server Actions must
   have serializable arguments, so a `SupabaseClient` object can't be a param. Instead, their
   logic moved into new shared service functions (`setProspectStatus`, `recordInboundMessage`
   in `src/lib/services/outbound.ts`) that both the action (calling with `createClient()`) and
   the `/api/v1` routes (calling with the admin client) share.
6. **`POST /api/v1/prospects/:id/notes`** can't reuse `addProspectNote()` as-is (it requires a
   session user via `getCurrentUser()`, which doesn't exist under token auth). The route
   inserts directly, attributing `created_by` to the token's own `created_by` user — the person
   who minted the token — rather than leaving it null.
7. **`POST /api/v1/posts/:id/published` doesn't set `source: "manual"`** despite the spec asking
   for it. `scheduled_posts.source` is documented and used elsewhere as "which Pulse surface
   *created* this post" (`composer`/`engage`/`ai-content`), not how it was published — overwriting
   it would destroy real provenance data other code reads. `platform_post_id`/`platform_post_url`/
   `status`/`posted_at` are set exactly per spec; `source` is left untouched.
8. **`POST /api/v1/posts/:id/metrics`'s `notes` field has no column to land in** —
   `own_post_metrics` has no `notes` column. It rides inside the existing `metrics` jsonb blob
   alongside `likes`/`comments`/etc. rather than triggering a schema migration for one optional
   field.
9. **`GET /api/v1/media/*path` isn't a signed URL** — no signed-GET function exists anywhere in
   this codebase (only signed *PUT*, for uploads); every R2 read in the app already resolves via
   a public bucket URL (`r2PublicUrl()`). This route validates the key's tenant segment against
   the token and that the object exists, then returns that same public URL — tenant isolation is
   enforced by the auth check, not by R2-level signing.
10. **`services/scheduled-posts.ts` wasn't refactored for client injection** — it hardcodes
    `createClient()` *and* only selects a narrower column set than the real table (no
    `media_paths`, `platform_post_id`, etc. — it's tuned for its own calendar-UI use case). The
    Publishing routes run their own thin admin-scoped queries against `scheduled_posts` directly,
    selecting the full column set they need, rather than forcing that service to serve two
    different shapes.
11. **`POST /api/v1/inbox/:id/reply-draft` wraps `generateEngagementReplyDraft()`
    (`src/lib/ai/engagement-reply.ts`), not `ai/engage.ts`** as the spec's endpoint table
    suggested. `ai/engage.ts`'s `draftEngagementAi()` generates a quote-post + reply pair for
    *outbound* discovery candidates (`engage_candidates` — a different table entirely, with no
    inbox/reply-needed semantics). `engagement-reply.ts` is what the existing in-app approval
    queue actually uses for this exact "draft a reply to an inbound comment/DM" job, and is the
    correct fit.
12. **No SEO write endpoint exists yet** despite `seo:write` being a grantable scope —
    `seo_recommendations`' `applied`/`dismissed`/`snoozed` transitions are currently in-app-only.
    The scope is reserved for a future `POST /api/v1/seo/recommendations/:id/status`-shaped
    endpoint, not dead.
13. **`GET /api/v1/content-calendar` is allowlist-gated, not just persona-gated** — it 404s for
    every tenant except the single dogfood tenant on `isContentCalendarEnabledForTenant()`'s
    allowlist, mirroring the in-app page's own gate exactly (see `CLAUDE.md`'s Content Calendar
    section). A token minted for any other tenant gets the same 404 the page would show.
14. **`POST /api/v1/captions/compose` and `POST /api/v1/blog-posts` attribute `created_by` to the
    token's owner** (`tenant_api_tokens.created_by`), not a session user — same pattern as
    `POST /api/v1/prospects/:id/notes`. Their underlying `"use server"` actions
    (`actions/compose.ts`'s `generateDraft`, `actions/blog-posts.ts`'s `createManualBlogPost`)
    couldn't be reused directly (Server Actions can't take a `SupabaseClient` param), so their
    logic was duplicated into new client-injected service functions
    (`composeAndSaveApi` in a new `src/lib/services/social-drafts.ts`, `createManualBlogPostApi`
    in `src/lib/services/blog-posts.ts`) rather than modifying the actions.
15. **The approve/reject routes don't go through `requireApiContext()`** — they're the one
    deliberate exception to "every /api/v1 route is bearer-token-authed." The signed token in the
    path *is* the credential (see `src/lib/approvals/token.ts`); there is no tenant_api_token and
    no session on the public approval page. `manifest.ts` lists their scope as `null` for the same
    reason `/me` and `/manifest` do, but for a different underlying reason (those need *any*
    valid bearer token; these need *no* bearer token at all, a signed path token instead).
16. **`POST /api/v1/briefings/send` isn't gated by a single fixed scope** — the required scope
    depends on the request body's `targetType` (parsed before the scope check runs), so it can't
    use `requireApiContext()`'s single-scope signature. The route re-implements
    `requireApiContext`'s pre-auth rate limit + token resolution + post-auth rate limit steps
    inline, then checks `hasScope()` manually once `targetType` is known. `pulse_send_briefing`
    does the equivalent with `requireToolScope(extra, null)` (any valid token) followed by a
    manual `hasScope()` check.
17. **No `approval_jti` replay-ledger table** — unlike `seo_preview_jti` (the other JWT-issuing
    module in this codebase), approval tokens have no separate one-time-use ledger. The
    `approval_requests` row's own `status` column (flipped away from `pending` by the first
    approve/reject) *is* the ledger — a second attempt lands on the "already actioned" branch via
    a conditional `UPDATE ... WHERE status = 'pending'`, not a jti lookup. One fewer table, same
    guarantee, because every token here is already 1:1 with a real row (unlike the preview
    tokens, which don't correspond to a mutable row at all).
18. **Expiry is computed at read time (`token_expires_at < now()`), not swept by a cron** — a
    stale `approval_requests` row just stays `status='pending'` forever; there's no
    `sweep-expired-approvals` job. `seo_preview_jti` has a cron sweep because its ledger rows
    accumulate and need periodic deletion; `approval_requests` rows are few, permanent audit
    records (who was asked what, when, and what they decided), not a ledger to be cleaned up.

## Production bugs found and fixed while building this group

Neither of these was introduced by this work — both predate it and were caught by testing the
new routes against real data (with explicit sign-off before each fix was applied to production).

1. **`scheduled_posts` was missing 10 columns** that migration 067 defines (`content`,
   `media_paths`, `platform_post_id`, `platform_post_url`, `source`, `error_message`,
   `connection_id`, `source_draft_id`, `qstash_message_id`, `posted_at`) — a `create table if not
   exists` had no-op'd against an older, narrower table that already existed. Composer/Schedule
   could not have persisted real post content or a published post's id/URL until this was fixed.
   Reconciled by migration 089 (confirmed safe: the table had 0 rows).
2. **`own_post_metrics`'s unique index was partial** (`where scheduled_post_id is not null`),
   which Postgres can't use to satisfy an `ON CONFLICT (scheduled_post_id, platform)` upsert —
   every such upsert failed with `"there is no unique or exclusion constraint matching the ON
   CONFLICT specification"`. This is the same upsert shape `/api/cron/sync-post-metrics` uses
   daily, so that cron has very likely been silently failing this step in production since
   migration 068 shipped. Fixed by migration 090 (full unique index — same fix pattern migration
   057 already used once for `engagement_items`).

## MCP server

A remote MCP server exposing every capability above as an MCP tool, for AI agents whose sandbox
has no outbound internet (Cowork's shell can't reach Pulse over plain HTTP — the MCP transport
is the supported path). Same auth, same service layer, same tenant isolation as the REST API —
this is a second transport onto the identical `requireApiContext`-equivalent gate, not a parallel
implementation. Built with [`mcp-handler`](https://github.com/vercel/mcp-handler) +
`@modelcontextprotocol/sdk`.

**Endpoint:** `https://pulse-ashy-kappa.vercel.app/api/mcp`

**Transport:** Streamable HTTP only for now. SSE needs Redis for cross-instance session
resumability (`mcp-handler`'s `redisUrl` config) — deferred until `@upstash/redis` +
`REDIS_URL` are provisioned; streamable HTTP works fully for Cowork today with no Redis
dependency.

### Connecting from Cowork

Two ways to add Pulse as a custom MCP connector, both hitting the same `/api/mcp` endpoint:

**URL only (recommended)** — leave Cowork's Client ID/Secret fields blank:
- **URL**: `https://pulse-ashy-kappa.vercel.app/api/mcp`

Cowork auto-discovers everything else: it fetches `/.well-known/oauth-protected-resource` to find
the authorization server, then `/.well-known/oauth-authorization-server` for its endpoints,
dynamically registers itself via `POST /api/oauth/register` (no manual client setup), and drives
the user through a normal browser login + tenant-consent screen. See "OAuth 2.1 for MCP clients"
below for the full flow.

**Static bearer token** — paste a token directly, no OAuth round-trip:
- **URL**: `https://pulse-ashy-kappa.vercel.app/api/mcp`
- **Auth**: Bearer token — the same `pulse_ext_...` token minted at Settings → Integrations →
  API tokens (identical tokens/scopes power both `/api/v1` and the MCP tools; mint once, use on
  either surface).

A token/session with no scopes beyond the default `*:read` set can call every read-only tool
below; add `sales:write`/`publish:write`/`engage:write` etc. for the mutating ones a skill needs.

### Auth model

`withMcpAuth()` wraps the whole handler and calls `verifyToken()` once per request, before any
tool runs. `verifyToken()` branches on the bearer token's shape: a `pulse_ext_...` token goes
through `resolveApiToken()` (the exact same function `/api/v1`'s `requireApiContext()` calls); any
other token is tried as an OAuth access token via `verifyAccessToken()` (`src/lib/oauth/tokens.ts`).
Both branches produce the identical `AuthInfo` shape — `{tenantSlug, tokenId, scopes,
createdBy}` stashed on `extra.authInfo.extra` — so every tool re-derives a scoped context from it
via `requireToolScope()` (`src/lib/api/mcp-context.ts`) without knowing or caring which auth path
was used. **No tool accepts a tenant argument from the model** — a missing/revoked/scope-less
token or session gets a real MCP tool error (`isError: true`), never silent cross-tenant access.

### OAuth 2.1 for MCP clients

A full OAuth 2.1 authorization server, added so Cowork (and any other MCP client that only takes
a URL) can connect without a manually-minted static token. This is **MCP-route-only** — `/api/v1`
REST and the Chrome extension keep using `pulse_ext_...` tokens exactly as before; nothing about
that path changed.

**Endpoints:**

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource` | RFC 9728 — tells clients where the authorization server lives (rewrites to `/api/oauth/protected-resource-metadata`, built on `mcp-handler`'s own helper) |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 — authorization/token/registration endpoint URLs, supported scopes, PKCE methods (rewrites to `/api/oauth/authorization-server-metadata`, hand-rolled — `mcp-handler` doesn't provide this) |
| `POST /api/oauth/register` | RFC 7591 Dynamic Client Registration — public clients only, no `client_secret` issued (`token_endpoint_auth_method: "none"`) |
| `GET /oauth/authorize` | Browser-facing consent page — goes through the normal Supabase Auth login gate, then lets the signed-in user pick which tenant to authorize |
| `POST /api/oauth/token` | Token endpoint — `authorization_code` grant (PKCE-verified) and `refresh_token` grant (rotates on every use) |

**Flow:** client registers via DCR → redirects the user to `/oauth/authorize?client_id=...&
redirect_uri=...&code_challenge=...&code_challenge_method=S256&state=...` → user logs in (if not
already) → consent screen lists every tenant where the user is `owner` or `admin` → user picks one
and approves → redirected back to the client with a one-time authorization code → client exchanges
the code + PKCE verifier at `/api/oauth/token` for a short-lived access token (1 hour, self-
contained HS256 JWT — no DB lookup per request) and a refresh token (opaque, DB-stored, hashed,
rotated on every use).

**Tenant-selection UX:** there is no separate "which tenant" step baked into the URL — the
consent page itself is where tenant selection happens, scoped to memberships where the user's
role is `owner` or `admin` (the same bar as minting a `tenant_api_tokens` row today). If the user
has exactly one eligible tenant it's pre-selected, but the explicit "Authorize '<client name>' for
'<tenant>'?" confirmation always shows — never silently skipped. Zero eligible tenants renders an
explicit empty state, not a silent failure.

**PKCE is mandatory, S256 only** — no plain-text challenge method, matching current OAuth 2.1
best practice for public clients that can't hold a secret.

**Env var:** `MCP_OAUTH_JWT_SECRET` — HS256 signing secret for access tokens, a dedicated key
separate from `PULSE_JWKS_PRIVATE_KEY` (that key is a different trust boundary: Pulse signs,
Gruve verifies, for the Pulse→Gruve publish path). Required in `.env.local` and every Vercel
environment before this flow works; `isMcpOAuthConfigured()` graceful-degrades to a clean 500 if
unset rather than silently minting unverifiable tokens.

**Not implemented:** `POST /api/oauth/revoke` (RFC 7009) — not required for Cowork to connect.
Today the only way to revoke a refresh token early is deleting its `oauth_refresh_tokens` row
directly. Tracked in `TODOS.md`.

### Tool list

Every tool wraps the identical service function as its REST twin (`src/lib/services/*.ts`) — no
duplicated business logic between the two transports. Full request/response shapes match the
REST endpoint sections above; call `pulse_manifest` for the always-current source of truth.

**Meta**

| Tool | REST twin | Scope |
|---|---|---|
| `pulse_whoami` | `GET /me` | any valid token |
| `pulse_manifest` | `GET /manifest` | any valid token |

**Sales**

| Tool | REST twin | Scope |
|---|---|---|
| `pulse_list_prospects` | `GET /prospects` | `sales:read` |
| `pulse_get_prospect` | `GET /prospects/:id` | `sales:read` |
| `pulse_upsert_prospect` | `POST /prospects` | `sales:write` |
| `pulse_draft_dm` | `POST /prospects/:id/draft-dm` | `sales:write` |
| `pulse_mark_dm_sent` | `POST /dms/:id/sent` | `sales:write` |
| `pulse_list_followups` | `GET /follow-ups` | `sales:read` |
| `pulse_add_prospect_note` | `POST /prospects/:id/notes` | `sales:write` |
| `pulse_set_prospect_stage` | `POST /prospects/:id/stage` | `sales:write` |
| `pulse_record_inbound` | `POST /prospects/:id/inbound` | `sales:write` |
| `pulse_capture_event_lead` | `POST /event-leads` | `sales:write` |
| `pulse_outbound_filters` | `GET /outbound/filters` | `sales:read` |
| `pulse_outbound_templates` | `GET /outbound/templates` | `sales:read` |

**Publishing / social loop**

| Tool | REST twin | Scope |
|---|---|---|
| `pulse_publish_queue` | `GET /publish-queue` | `publish:read` |
| `pulse_post_media` | `GET /media/*path` | `publish:read` |
| `pulse_record_published` | `POST /posts/:id/published` | `publish:write` |
| `pulse_record_post_metrics` | `POST /posts/:id/metrics` | `publish:write` |

**Engagement**

| Tool | REST twin | Scope |
|---|---|---|
| `pulse_inbox` | `GET /inbox` | `engage:read` |
| `pulse_reply_draft` | `POST /inbox/:id/reply-draft` | `engage:write` |
| `pulse_mark_replied` | `POST /inbox/:id/replied` | `engage:write` |

**Intelligence**

| Tool | REST twin | Scope |
|---|---|---|
| `pulse_intel_feed` | `GET /intel/feed` | `intel:read` |
| `pulse_trends` | `GET /trends` | `intel:read` |
| `pulse_competitors` | `GET /competitors` | `intel:read` |

**SEO**

| Tool | REST twin | Scope |
|---|---|---|
| `pulse_seo_recommendations` | `GET /seo/recommendations` | `seo:read` |
| `pulse_seo_ranks` | `GET /seo/rank` | `seo:read` |
| `pulse_seo_topical_map` | `GET /seo/topical-map` | `seo:read` |

**Analytics**

| Tool | REST twin | Scope |
|---|---|---|
| `pulse_analytics_overview` | `GET /analytics/overview` | `analytics:read` |
| `pulse_post_insights` | `GET /analytics/posts` | `analytics:read` |
| `pulse_weekly_review` | `GET /weekly-review` | `analytics:read` |

**Content**

| Tool | REST twin | Scope |
|---|---|---|
| `pulse_list_briefs` | `GET /briefs` | `content:read` |
| `pulse_generate_brief` | `POST /briefs` | `content:write` |
| `pulse_content_calendar` | `GET /content-calendar` | `content:read` |
| `pulse_list_blog_posts` | `GET /blog-posts` | `content:read` |
| `pulse_get_blog_post` | `GET /blog-posts/:id` | `content:read` |
| `pulse_create_blog_post` | `POST /blog-posts` | `content:write` |
| `pulse_compose_caption` | `POST /captions/compose` | `content:write` |

**Notifications / mobile approvals**

| Tool | REST twin | Scope |
|---|---|---|
| `pulse_send_briefing` | `POST /briefings/send` | `publish:write` (scheduled_post) or `content:write` (content_brief) |
| `pulse_list_pending_approvals` | `GET /approvals/pending` | `content:read` |

No `pulse_approve`/`pulse_reject` tools — approval must be a deliberate human action taken via the
signed link, not something an AI agent can call on the tenant's behalf.

39 tools total across all 9 groups (Meta, Sales, Publishing, Engagement, Intelligence, SEO,
Analytics, Content, Notifications) — every group in the original build spec.

### Deviations (MCP)

1. **Route location**: the handler lives at `src/app/api/[transport]/route.ts`, not
   `src/app/api/mcp/[transport]/route.ts`. `[transport]` is a literal segment `mcp-handler`
   resolves itself (`mcp` for streamable HTTP, `sse`/`message` for SSE) — confirmed against the
   library's own `calculateEndpoints` tests, not just doc prose. `basePath: "/api"` + this
   location is what produces the clean `/api/mcp` public URL; nesting a real `mcp/` folder in
   between would have produced `/api/mcp/mcp`.
2. **`pulse_inbox` / `pulse_reply_draft` naming**: the build spec's tool-name line for these two
   arrived corrupted in transit (`pulse_inbply`, with the `GET /inbox` tool's name missing
   entirely). Reconstructed as `pulse_inbox` (→ `GET /inbox`) and `pulse_reply_draft` (→
   `POST /inbox/:id/reply-draft`), matching the REST endpoint count and the naming convention
   every other tool follows (`pulse_<verb>_<noun>`).
3. **Streamable HTTP only** — see "Transport" above.
4. **Zero-argument tools need a two-arg callback even with `inputSchema: {}`.** The SDK's
   `ToolCallback` type only uses the single-arg `(extra) => ...` form when `inputSchema` is
   *omitted* entirely; passing an empty object still selects the two-arg `(args, extra) => ...`
   form. `pulse_whoami`, `pulse_manifest`, `pulse_list_followups`, and `pulse_outbound_filters`
   initially used the single-arg form and silently received `{}` in place of `extra` — every call
   failed auth with "Unauthorized: no valid token" even with a valid token, since `extra.authInfo`
   was never actually there. Caught by the smoke test, fixed by giving all four an explicit
   `(_args: Record<string, never>, extra) => ...` signature.
5. **Tool result errors use `isError: true`** with a plain-text message, not the REST layer's
   `{error, issues}` shape — that's the MCP protocol's own error convention
   (`src/lib/api/mcp-context.ts`'s `mcpToolError()`), not a departure from anything REST-specific.

## Pre-landing review findings (fixed before shipping)

Caught during the pre-landing review pass, not by any automated test:

1. **`recordManualPublish` had a TOCTOU race** — it checked `status !== 'published'` then wrote in
   a separate statement; two concurrent calls could both pass the check and both report success
   instead of one 200 + one 409. Fixed to a single conditional `UPDATE ... WHERE status !=
   'published'`, using the updated-row count (not a prior read) to distinguish "I published it"
   from "someone else already did."
2. **MCP tools skipped rate limiting entirely** — `requireToolScope()` (the MCP-transport auth
   gate) never called `checkRateLimit()`, unlike REST's `requireApiContext()` which does for every
   route. Fixed by adding the same per-token check to `requireToolScope()`.
3. **Migration 090's `CREATE INDEX` isn't `CONCURRENTLY`** — briefly locks writes to
   `own_post_metrics` during the rebuild. Already applied (the table is small, so this was almost
   certainly negligible) — noted here as a lesson for future migrations on tables that could be
   larger, not something to redo.
4. **500 responses pass through raw Postgres error messages** (`error.message` from Supabase)
   across every route — consistent with the pattern established since PR1, but worth flagging:
   this can leak schema details (column/constraint names) to an authenticated caller on a genuine
   server error. Accepted as a known limitation for this PR rather than a blocking rewrite across
   ~20 routes; a generic "Internal error" response (logging the real error server-side only) is a
   reasonable follow-up.

## Adversarial review findings (Claude subagent, fixed before shipping)

5. **PostgREST filter-string injection via `GET /prospects?search=`** — `listProspects()`
   (`src/lib/services/outbound.ts`) spliced the raw `search` string into a hand-built `.or(...)`
   filter expression with no escaping of `,`/`.`/`(`/`)`. The `tenant_slug` filter is a separate
   query-builder call (not part of this string), so this was never a cross-tenant leak — but a
   caller could inject additional OR'd conditions on other `prospects` columns within their own
   tenant, or malform the filter into a 500 (error-oracle). Reachable via both
   `GET /api/v1/prospects?search=` and `pulse_list_prospects`. Fixed by stripping
   `,.()"%*` from the search term before interpolating (none of these are meaningful in a fuzzy
   handle/name/bio search anyway). Regression test in `tests/integration/api-v1-sales.test.ts`.
6. **No rate limiting before the token-lookup DB call** — `checkRateLimit()` only engages *after*
   a token resolves; any request with a well-formed `pulse_ext_...`-prefixed bearer costs a real
   Supabase admin-client round-trip regardless of validity, with nothing throttling that ahead of
   time — a cheap volumetric cost/DoS vector against both `/api/v1/*` and `/api/mcp`. Fixed by
   adding `checkPreAuthRateLimit()` (300 req/min per IP, generous since legitimate callers can
   share an IP behind NAT) ahead of `resolveApiToken()` in both `requireApiContext()` and the MCP
   route's `verifyToken()`. On the MCP side this surfaces as the same 401 shape a bad token would
   (the SDK's `withMcpAuth` only distinguishes success/failure, not a distinct 429) — a minor,
   accepted simplification there.

**Investigated, not changed:**
- `getLatestAnalysis(client, prospectId)` (`services/outreach-intelligence.ts`) has no
  `tenant_slug` filter — safe today because it's only ever called with the session-scoped RLS
  client, never the admin client from any `/api/v1`/MCP path, but flagged as a landmine for
  whoever wires it into an admin-client caller next.
- Migration 088 only rewrites `scope='extension'` tokens, not the other 3 legacy enum values
  (`cli`/`automation`/`other`) — those fail closed (403 on every scoped route) rather than leak
  anything, so not urgent; worth a one-time check of how many such tokens actually exist in
  production before assuming this orphaned zero of them.
- R2 media URLs are permanently-public, unauthenticated bucket URLs gated only at the app layer
  (`resolveTenantMediaKey`'s tenant check) — pre-existing architecture, but this PR is the first
  thing that hands that URL to an external third-party AI agent (Cowork) holding a long-lived
  token, so any caching/retention on their side becomes a permanent, unrevocable leak path for
  that asset independent of later token revocation. Accepted as a known architectural risk, not
  fixed here — a real signed-GET mechanism would be the eventual fix.
