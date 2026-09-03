# Build brief — Action Queue (the daily command surface)

Paste this whole file into Claude Code with the Pulse repo open.

---

## 0. What this is and why

Pulse is being driven daily by an agent (Claude, running the `agent-social` skill) that works
Gruve's real Instagram through a logged-in browser. It reads comments, DMs, followers and
profiles, decides what needs a reply, drafts the reply, and gets human approval before sending.

Right now that work has nowhere to live. It happens in a chat window, and when the chat closes
it is gone. Nobody else on the team can see what is outstanding, and the human cannot act on
anything from their phone.

**Goal: one board in Pulse that is the single list of everything needing attention, writable by
the agent over MCP and actionable by a human in the UI.** Each row carries the message, a
proposed reply that a human can edit, a deep link that opens the exact comment or DM on
Instagram, and a resolve action. Both sides write to it. The agent populates and can resolve;
the human edits, resolves, or reassigns.

This is not a new product area. Most of the schema already exists and is unused.

---

## 1. Ground truth found in this repo (read these before changing anything)

| Thing | Path | State |
| --- | --- | --- |
| Engagement table | `supabase/migrations/008_engagement.sql` | `engagement_items` — has `type`, `platform`, `from_name`, `from_handle`, `content`, `post_title`, `external_url`, `received_at`, `read`, `replied`, `sentiment`, `notes` |
| Shared-inbox columns | `supabase/migrations/102_shared_inbox_conversations.sql` | **Already added** `assigned_to`, `status` (`open`/`resolved`), `sent_body` to `engagement_items` and `inbound_messages`, plus `uq_engagement_items_external(tenant_slug, platform, external_id)` and status/handle indexes |
| Read service | `src/lib/services/engagement.ts` | `listInboxItems`, `draftAndSaveReply`, `markInboxReplied` |
| REST | `src/app/api/v1/inbox/route.ts`, `src/app/api/v1/inbox/[id]/reply-draft/route.ts`, `src/app/api/v1/inbox/[id]/replied/route.ts` | GET list, POST LLM draft, POST mark replied |
| MCP tools | `src/lib/mcp/tools/engagement.ts` | `pulse_inbox`, `pulse_reply_draft`, `pulse_mark_replied` |
| Conversations UI | `src/app/(app)/conversations/page.tsx` + `ConversationsClient.tsx` | Shared inbox, already in nav |
| Nav | `src/lib/nav-config.ts` | `/dashboard`, `/conversations`, etc. |
| Dashboard | `src/app/(app)/(overview)/dashboard/page.tsx`, `src/lib/services/dashboard.ts` | KPI tiles |
| IG sync cron | `src/app/api/cron/composio-sync-engagement/route.ts` | Pulls IG comments + DMs into `engagement_items` |
| Follow-ups | `src/app/api/v1/follow-ups/route.ts` | overdue / dueToday / newReplies / goingCold, prospect-based |

**The schema from migration 102 is live but nothing reads or writes it.** `listInboxItems` does
not select `status`, `assigned_to`, `sent_body` or `external_id`, so neither the API nor MCP can
see or set them. Most of this brief is finishing that job rather than starting a new one.

---

## 2. Two defects to fix first (they are why the board would otherwise show nothing)

### 2.1 The Gruve Instagram inbox is stale and probably seeded

`GET /api/v1/inbox?platform=instagram&unanswered=true` for tenant `gruve` returns exactly three
rows, all timestamped `2026-07-31`, with near-identical sub-second values
(`11:46:59.719`, `10:46:59.721`, `05:46:59.721`) — one batch insert, not organic arrival. One
asks about "VIP tickets for the April show" in a July message. Meanwhile the live
`@gruvetickets` account had four unread DM threads and four unanswered comments from the
preceding five days, none of which are in Pulse.

Do this:
1. Check `connected_accounts` for `tenant_slug='gruve' AND toolkit='instagram'` — is a row active,
   and what is `last_synced_at`?
2. Check `cron_runs` (or whatever `withCronRun` writes to) for `composio-sync-engagement` — is it
   running, and is it erroring?
3. Identify those three rows (likely `source` is not `'composio'`) and delete or flag them. Seed
   data in a queue that humans are told to trust is worse than an empty queue.

### 2.2 Two likely bugs in `composio-sync-engagement`

Both in `src/app/api/cron/composio-sync-engagement/route.ts`:

- **`received_at` is never set on insert.** The comment upsert writes `created_at: c.timestamp`
  but leaves `received_at` to default to `now()`. Every reader — `listInboxItems`,
  `getEngagementItems`, the new indexes from 102 — orders and filters by `received_at`. So a
  comment from three days ago sorts as if it arrived at sync time. Set
  `received_at: c.timestamp` explicitly, and backfill existing rows where `source='composio'`.
- **The `since` gate can strand a tenant permanently.** `since` comes from `conn.lastSyncedAt`
  and anything at or before it is skipped. If `last_synced_at` is advanced on a run that
  partially failed, everything in that window is skipped forever with no retry and no alert.
  Make the watermark advance only on a fully successful pass, and add an overlap window
  (re-scan the last 24h; the unique index makes it idempotent).

---

## 3. What to build

### 3.1 Migration `105_action_queue.sql`

**A. Widen the engagement status model.** The `open`/`resolved` check from 102 is too narrow for a
real queue.

```sql
alter table engagement_items drop constraint if exists engagement_items_status_check;
alter table engagement_items
  add constraint engagement_items_status_check
  check (status in ('open','snoozed','resolved','dismissed'));

alter table engagement_items
  add column if not exists priority text not null default 'normal'
    check (priority in ('urgent','high','normal','low')),
  add column if not exists due_at timestamptz,
  add column if not exists proposed_reply text,
  add column if not exists proposed_reply_author text
    check (proposed_reply_author in ('agent','human','ai_generated')),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;
```

`proposed_reply` is deliberately separate from `ai_draft` and from `sent_body`. Migration 102's
header already makes this argument for `sent_body`: `ai_draft` is consumed by `/api/v1` and MCP
under the contract "AI-authored content", and overloading it silently breaks external readers.
The same reasoning applies here. `proposed_reply` is the editable candidate text — written by
the agent, edited by a human, promoted to `sent_body` once actually sent.

Apply the same widened status, `priority`, `due_at`, `proposed_reply*`, `resolved_*` columns to
`inbound_messages` so WhatsApp rides the same board later.

**B. A table for attention that is not a message.** A pending collab invitation, a prospect going
cold, a decision the human owes. These have no `engagement_items` row.

```sql
create table if not exists action_items (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  kind text not null check (kind in
    ('reply','follow_up','decision','escalation','opportunity','chore')),
  title text not null,
  body text,
  why text,                       -- the agent's one-line reason this is on the board
  priority text not null default 'normal'
    check (priority in ('urgent','high','normal','low')),
  status text not null default 'open'
    check (status in ('open','snoozed','resolved','dismissed')),
  platform text,
  external_url text,              -- deep link the View button opens
  action_label text,              -- e.g. "Open comment", "Open DM", "Accept invite"
  proposed_reply text,
  proposed_reply_author text check (proposed_reply_author in ('agent','human','ai_generated')),
  engagement_item_id uuid references engagement_items(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete cascade,
  source text not null default 'agent',   -- 'agent' | 'cron' | 'human'
  source_run_id uuid,
  dedupe_key text,                -- stable key so re-running a sweep updates, not duplicates
  assigned_to uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_action_items_dedupe
  on action_items(tenant_slug, dedupe_key) where dedupe_key is not null;
create index if not exists idx_action_items_board
  on action_items(tenant_slug, status, priority, due_at);

alter table action_items enable row level security;
drop policy if exists "members access action_items" on action_items;
create policy "members access action_items" on action_items
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
```

`dedupe_key` matters. The agent runs daily and will re-observe the same unanswered comment every
day. Without it the board grows by duplicates. Convention:
`ig:comment:<media_id>:<comment_id>`, `ig:dm:<thread_id>`, `prospect:<id>:followup`.

**C. A run log,** so "new since the last run" is answerable server-side instead of being
guessed in a chat window:

```sql
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  agent text not null,                  -- 'agent-social'
  surface text,                         -- 'instagram'
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_runs_tenant
  on agent_runs(tenant_slug, agent, started_at desc);

alter table agent_runs enable row level security;
drop policy if exists "members access agent_runs" on agent_runs;
create policy "members access agent_runs" on agent_runs
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
```

### 3.2 Service layer — `src/lib/services/action-queue.ts`

One module, used by REST, MCP and the server components alike, matching the existing pattern in
`src/lib/services/engagement.ts`.

- `listActionQueue(client, tenantSlug, { status?, kind?, priority?, assignedTo?, platform?, since?, limit, offset })`
  Returns a **unified, grouped** board. Normalise `engagement_items` rows and `action_items` rows
  into one `QueueRow` shape so the UI and MCP never branch on source:
  ```ts
  type QueueRow = {
    id: string; source: "engagement" | "action";
    kind: "reply" | "follow_up" | "decision" | "escalation" | "opportunity" | "chore";
    platform: string | null; channel: "comment" | "dm" | "mention" | "other" | null;
    title: string; body: string | null; why: string | null;
    fromName: string | null; fromHandle: string | null;
    externalUrl: string | null; actionLabel: string | null;
    proposedReply: string | null; proposedReplyAuthor: string | null;
    sentBody: string | null;
    priority: string; status: string;
    assignedTo: string | null; dueAt: string | null; snoozedUntil: string | null;
    receivedAt: string; resolvedAt: string | null;
  };
  ```
  Default grouping, in this order — this is the hierarchy Aise asked for:
  1. **Needs a reply** — unanswered comments and DMs, oldest first. A question from a known
     prospect outranks a compliment.
  2. **Needs a decision** — things only a human can answer (a collab invite, a fee, a refund).
  3. **Follow-ups due** — overdue, then due today.
  4. **Going cold** — no reply after N days.
  5. **Opportunities** — new leads worth a first touch.
  Snoozed rows are hidden until `snoozed_until` passes. Resolved rows drop off and are reachable
  under a "Resolved today" toggle.
- `upsertEngagementItem(client, tenantSlug, input)` — insert-or-update on
  `(tenant_slug, platform, external_id)` using `uq_engagement_items_external`. **This is the
  single most important new function**; without it the agent cannot put anything it sees into
  Pulse, and today it cannot.
- `upsertActionItem(client, tenantSlug, input)` — on `(tenant_slug, dedupe_key)`.
- `setProposedReply(client, tenantSlug, rowRef, { text, author })` — writes `proposed_reply`,
  never `ai_draft`.
- `setQueueStatus(client, tenantSlug, rowRef, { status, resolutionNote?, snoozedUntil?, resolvedBy? })`
  — when status becomes `resolved` on an engagement row, also set `replied = true` and
  `resolved_at`, so the legacy boolean stays truthful for existing readers.
- `assignQueueRow`, `setPriority`, `setDueAt`.
- `startAgentRun` / `finishAgentRun`.

`rowRef` is `{ source: "engagement" | "action", id: string }`. Every mutation must be
tenant-scoped explicitly, not RLS-only, because MCP and `/api/v1` authenticate with the admin
client under a tenant token — `markInboxReplied` already documents this trap in its comment.

### 3.3 REST — `/api/v1`

Follow the existing shape exactly: `requireApiContext(req, scope, METHODS)`, `corsPreflight`,
`apiOk` / `apiError` / `apiPaginated`, `export const dynamic = "force-dynamic"`.

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/action-queue` | `engage:read` | The grouped board |
| POST | `/api/v1/inbox` | `engage:write` | **Upsert an observed comment/DM.** The missing write |
| PATCH | `/api/v1/inbox/:id` | `engage:write` | `proposedReply`, `priority`, `dueAt`, `assignedTo`, `externalUrl` |
| POST | `/api/v1/inbox/:id/status` | `engage:write` | `open`/`snoozed`/`resolved`/`dismissed` + note |
| GET | `/api/v1/action-items` | `engage:read` | Non-message items |
| POST | `/api/v1/action-items` | `engage:write` | Upsert by `dedupeKey` |
| PATCH | `/api/v1/action-items/:id` | `engage:write` | Same editable fields |
| POST | `/api/v1/action-items/:id/status` | `engage:write` | Resolve / snooze / dismiss |
| POST | `/api/v1/agent-runs` | `engage:write` | Open a run, returns `runId` |
| POST | `/api/v1/agent-runs/:id/finish` | `engage:write` | Close it with a summary |
| **POST** | **`/api/v1/me`** | **`admin`** | **Write brand voice / positioning — see §4** |

Keep `POST /api/v1/inbox/:id/replied` working as an alias for `status: "resolved"`. Existing
callers must not break.

Add every new route to `src/app/api/v1/manifest/route.ts`. The agent discovers capability from
the manifest, so an endpoint missing there does not exist as far as it is concerned.

### 3.4 MCP tools — `src/lib/mcp/tools/engagement.ts`

Mirror the REST 1:1, same as every other tool in this repo.

| Tool | Scope | Notes |
| --- | --- | --- |
| `pulse_action_queue` | `engage:read` | The grouped board. Filters: `status`, `kind`, `priority`, `platform`, `assignedTo`, `since` |
| `pulse_upsert_inbox_item` | `engage:write` | `{platform, type, externalId, fromName, fromHandle, content, postTitle?, externalUrl?, receivedAt, sentiment?, priority?, meta?}` |
| `pulse_set_proposed_reply` | `engage:write` | `{source, id, text, author}` — saves agent-authored text |
| `pulse_set_queue_status` | `engage:write` | `{source, id, status, resolutionNote?, snoozedUntil?}` |
| `pulse_assign_queue_row` | `engage:write` | `{source, id, assignedTo}` |
| `pulse_upsert_action_item` | `engage:write` | `{kind, title, body?, why?, priority?, platform?, externalUrl?, actionLabel?, proposedReply?, dedupeKey, prospectId?, dueAt?}` |
| `pulse_start_run` / `pulse_finish_run` | `engage:write` | Run log |
| `pulse_update_brand_voice` | `admin` | See §4 |

Also **extend `pulse_inbox`'s response** (and `listInboxItems`) to include `status`,
`assignedTo`, `sentBody`, `proposedReply`, `externalId`, `externalUrl`, `priority`, `dueAt`.
It currently returns none of them, which is why the agent cannot tell an open item from a
resolved one.

Keep tool descriptions blunt about which ones mutate. The agent reads them to decide what is
safe to call unattended.

### 3.5 UI — revamp `/dashboard`, do not add a page

**There is no new tab.** The Action Queue *becomes* the dashboard. A second destination would
just be another place nobody checks, and the current dashboard is the thing that needs fixing.

**What is wrong with `src/app/(app)/(overview)/dashboard/page.tsx` today.** It renders eight
blocks in a flat stack with no hierarchy and nothing actionable in any of them:
`NeedsYouBanner`, four `StatCard`s, `WeeklyReviewBanner`, `CoachFeed`, `CadenceRail`,
`PlatformBreakdown`, `PulseSuggestions`. Every one is read-only. You can look at it for a minute
and leave with nothing done. The "Ask Pulse" button in the header has no `onClick` at all — it is
a live button that does nothing. Most of what is on the page also has a better home that already
exists: `/weekly-report`, `/own-analytics`, `/today`.

**New structure, top to bottom:**

1. **Header.** Keep the title. Replace `Week of <date>` with the live state of the queue, e.g.
   `6 need a reply · 2 need a decision · oldest waiting 5 days`. Either wire "Ask Pulse" to
   something real or delete it. Keep `NotificationBell` and the `Weekly report` link.
2. **`NeedsYouBanner`.** Keep, directly under the header, collapsed by default when empty. It is
   setup gaps, it is genuinely P0, and it is small.
3. **The Action Queue. This is the body of the page**, not a widget on it. Grouped per §3.2
   (Needs a reply → Needs a decision → Follow-ups due → Going cold → Opportunities), with a count
   per group, groups collapsible, and everything below the fold. This is what a person comes to
   the dashboard to do.
4. **The numbers, compressed.** The four `StatCard`s move *below* the queue and shrink to one
   dense row. They are context, not the job.
5. **`CadenceRail`** stays below that, only when a tracker exists.
6. **`PlatformBreakdown`, `PulseSuggestions`, `WeeklyReviewBanner`** drop to a single collapsed
   "This week" section at the very bottom, or come off the page entirely and stay at
   `/weekly-report` and `/own-analytics` where they already live. Do not leave three read-only
   panels competing with the queue for attention.

**Absorb `CoachFeed` into the queue, do not run both.** `coach_actions` is already described in
CLAUDE.md as a "priority actions queue". Two competing action lists on one page is exactly the
confusion this work is meant to remove. Map active coach actions into `QueueRow` as
`kind: "chore"` or `kind: "opportunity"` with `source: "cron"` and a `dedupe_key` of
`coach:<action_id>`, so resolving one on the board resolves the underlying coach action. Then
delete the standalone `CoachFeed` block from the page.

**Row anatomy.** Each queue row shows: who it is from, platform, channel (comment or DM), how long
it has been waiting, the message itself, the agent's one-line `why`, and then:
- **the proposed reply in an editable textarea**, saving on blur via PATCH
- **View** — opens `external_url` in a new tab; on mobile this hands off to the Instagram app
- **Copy reply**
- **Mark resolved**, **Snooze** (1h / tonight / tomorrow / next week), **Assign**
- a priority chip, an assignee avatar, and an overdue state once `due_at` passes

Filters across the top: platform, kind, and **Mine / Unassigned / Everyone**, defaulting to
Everyone. Optimistic updates with rollback on failure.

**Nav.** No new nav item. `/dashboard` is already first in `src/lib/nav-config.ts`. Add the
unresolved count as a badge on that existing entry — `src/components/needs-you/NeedsYouBadge.tsx`
is the pattern to copy.

**Do not touch `/needs-you`.** It is setup status computed from `getSetupStatus` and it is a
different concept despite the similar name.

**Role-aware rendering, since the dashboard is now the shared surface.** A `support` member must
land on the queue, and must not see ad spend, prospect counts or the weekly review. So when
`tenantRole === "support"`, `DashboardPage` renders the header and the queue **only**, with the
queue filtered to `reply` and `follow_up`, and skips every other block. Do not rely on that
branch for security — it is a rendering choice on top of the RLS in §3.7, which is the real fence.

### 3.6 Deep links the agent will write

So `View` lands in the right place:

- comment → `https://www.instagram.com/p/<shortcode>/` (store the shortcode in `meta.shortcode`;
  Instagram has no per-comment permalink for business accounts, so the post is the correct target
  and the row carries the commenter handle to scan for)
- DM thread → `https://www.instagram.com/direct/t/<thread_id>/`
- profile → `https://www.instagram.com/<handle>/`

---

## 4. Brand voice must become writable

`GET /api/v1/me` returns brand voice and positioning; there is no write path. Gruve's stored
config is untouched placeholder — tone `"Clear, professional, and engaging voice for Gruve"`,
audience `"Customers and audience interested in Gruve"`, example post `"Welcome to Gruve! We're
excited to share our latest updates with you"`.

`generateEngagementReplyDraft` reads that config. So **every draft `pulse_reply_draft` returns is
placeholder voice wearing the tenant's name**, and it is being offered as an on-brand reply in a
DM to a paying organiser. That is the single highest-risk output in the system today.

Two things:
1. Add `POST /api/v1/me` (scope `admin`) writing `brand_voice` and `positioning`, plus MCP
   `pulse_update_brand_voice`. The settings screens at `settings/brand-voice` and
   `settings/brand-positioning` already write these — reuse their server actions rather than
   duplicating validation.
2. Add a placeholder detector, e.g. `src/lib/services/brand-voice-health.ts`, flagging a config
   as unauthored when two or more of these hold: an empty or null field; the tenant name
   substituted into an otherwise generic sentence; a value that would be true of any business;
   the `"Welcome to {Name}!"` example post; audience stated as "customers and audience interested
   in {Name}". Surface the flag on `/needs-you` as **P0**, and have `pulse_reply_draft` return
   the draft **with an explicit `brandVoiceUnauthored: true` warning** so an agent cannot send
   placeholder copy without noticing.

---

## 5. Acceptance criteria

1. `pulse_upsert_inbox_item` called twice with the same `externalId` produces one row, second call
   updates.
2. A row upserted by MCP appears on `/dashboard` within one refresh, with a working View link.
3. Editing the proposed reply in the UI persists, and the next `pulse_action_queue` call returns
   the edited text.
4. Resolving in the UI is visible to MCP on the next read, and vice versa. Round-trip both ways.
5. Resolving an engagement row sets `replied = true`, so `GET /api/v1/inbox?unanswered=true` stops
   returning it.
6. `dedupe_key` prevents the same unanswered comment appearing twice across two daily runs.
7. Snoozed rows are hidden until `snoozed_until`, then reappear.
8. Tenant isolation holds on every new endpoint under a tenant API token, not RLS alone. Add a
   test asserting tenant A cannot read or mutate tenant B's rows.
9. `/api/v1/manifest` lists every new endpoint with the right scope.
10. Existing `pulse_inbox`, `pulse_reply_draft`, `pulse_mark_replied` callers keep working
    unchanged.
11. `composio-sync-engagement` writes `received_at` from the platform timestamp, and its watermark
    only advances on a fully successful pass.
12. An unauthored brand voice raises a P0 on `/needs-you` and a warning flag on every generated
    draft.
13. A `support`-role member can open `/dashboard`, sees the queue filtered to `reply` and
    `follow_up` and no business metrics, can resolve those rows, and cannot read an `escalation`
    row through a direct Supabase call.
15. No new route is added. `/dashboard` is the only destination, and `CoachFeed` no longer renders
    as a separate block.
14. Two browsers on the same tenant see each other's resolve within a second (or one poll cycle),
    and a row already claimed by someone else says so before a second person starts typing.

## 6. Order of work

1. Diagnose §2.1 (the connection and the cron) before writing code. If the IG sync is dead, the
   board is empty no matter how good it is.
2. Migration `105_action_queue.sql`.
3. `services/action-queue.ts` + extend `listInboxItems`.
4. REST, then MCP mirroring it, then the manifest.
5. Revamp `/dashboard` in place — queue as the body, metrics compressed below, `CoachFeed` absorbed, badge on the existing nav entry.
6. Brand-voice write path and the placeholder detector.
7. Fix the two cron bugs in §2.2 and backfill `received_at`.

Ship 1 to 4 first. The board being writable by the agent is worth more than the board being
pretty, because until then the daily run has nowhere to put anything.
