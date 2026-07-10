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
| `content:read` / `content:write` | Briefs, content calendar, blog posts, captions *(not yet shipped)* |
| `seo:read` / `seo:write` | SEO recommendations, rank tracking, topical map *(not yet shipped)* |
| `intel:read` | Intel feed, trends, competitors *(not yet shipped)* |
| `analytics:read` | Analytics overview, per-post insights, weekly review *(not yet shipped)* |
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

## Not yet shipped

Content, SEO, Intelligence, and Analytics endpoint groups are planned follow-up PRs (see the
build spec). `GET /api/v1/manifest` is the source of truth for what's actually live at any given
time — check it rather than trusting this doc's endpoint table to be current.

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

Add Pulse as a custom MCP connector:
- **URL**: `https://pulse-ashy-kappa.vercel.app/api/mcp`
- **Auth**: Bearer token — the same `pulse_ext_...` token minted at Settings → Integrations →
  API tokens (identical tokens/scopes power both `/api/v1` and the MCP tools; mint once, use on
  either surface).

A token with no scopes beyond the default `*:read` set can call every read-only tool below; add
`sales:write`/`publish:write`/`engage:write` etc. for the mutating ones a skill needs.

### Auth model

`withMcpAuth()` wraps the whole handler and calls `resolveApiToken()` — the exact same function
`/api/v1`'s `requireApiContext()` calls — once per request, before any tool runs. The resolved
`{tenantSlug, tokenId, scopes, createdBy}` is stashed on `extra.authInfo.extra` and every tool
re-derives a scoped context from it via `requireToolScope()` (`src/lib/api/mcp-context.ts`), the
MCP-transport twin of `requireApiContext()`. **No tool accepts a tenant argument from the
model** — a missing/revoked/scope-less token gets a real MCP tool error (`isError: true`), never
silent cross-tenant access.

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

**Not yet shipped**: Content, SEO, Intelligence, Analytics tools — ship alongside their REST
groups per the revised build order (REST + MCP together per remaining group).

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
