-- Shared inbox schema for /conversations: assignment + status on both
-- `inbound_messages` (WhatsApp, via the webhook) and `engagement_items`
-- (Instagram/TikTok/Twitter/LinkedIn, via the composio-sync-engagement
-- cron), plus persisted sent-reply text. Phase 1 of the shared-inbox +
-- AI-away-reply track — schema only, no application code in this file.
--
-- Fixes two crux bugs (see plan doc, Track A):
--
-- 1. `inbound_messages` has never had the unique index its own upsert
--    target requires. Migration 057 added `uq_engagement_items_external
--    on engagement_items(tenant_slug, platform, external_id)` for the
--    composio sync path, but the WhatsApp webhook
--    (src/app/api/integrations/whatsapp/route.ts) upserts against
--    `onConflict: "tenant_slug,platform,external_id"` on
--    `inbound_messages` and no matching index was ever created there.
--    Every WhatsApp inbound upsert has been erroring, silently, since
--    the webhook shipped — this is the same bug class 090 and 057
--    already fixed once elsewhere in this schema. `uq_inbound_messages_external`
--    below closes it. This migration does not recover any history lost
--    to the silently-failing upsert before today; Meta's webhook isn't
--    replayable on demand.
--
-- 2. No sent-reply text is ever persisted, human or AI. `sent_body`
--    below is where every successful send (human-typed, human-approved
--    AI draft, or AI-auto-sent) will be written, with `approved_by` =
--    the human's user id or null for AI-authored sends. Deliberately a
--    new column, not a reuse of the existing `ai_draft` jsonb column —
--    `ai_draft` is already consumed by /api/v1 and MCP's
--    `listInboxItems` under the assumption it means "AI-authored
--    content"; overloading it to also hold human-typed text would
--    silently break that contract for every existing external reader.
--
-- `assigned_to`/`status` also land here (same shape on both tables) so
-- a thread can be claimed and resolved without a new `conversations`
-- table — grouping stays virtual (computed at read/write time from
-- sender identity), per the plan's explicit decision to add these
-- columns onto the existing tables for v1.
--
-- No RLS changes: both tables' existing `is_tenant_member(tenant_slug)`
-- policies already cover new columns.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. inbound_messages: identity, assignment, status, sent-reply text.
-- ─────────────────────────────────────────────────────────────────────────────
alter table inbound_messages
  add column if not exists from_handle text,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists status text not null default 'open' check (status in ('open', 'resolved')),
  add column if not exists sent_body text;

-- The missing unique index the webhook's onConflict has been targeting
-- since it shipped (see header comment, bug #1). Full (non-partial) —
-- NULL external_id rows stay allowed since Postgres treats NULLs as
-- distinct in a unique index, same reasoning as 057/090.
create unique index if not exists uq_inbound_messages_external
  on inbound_messages(tenant_slug, platform, external_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. engagement_items: assignment, status, sent-reply text.
--    (already has from_handle since 008, and uq_engagement_items_external
--    since 057 — nothing to add there.)
-- ─────────────────────────────────────────────────────────────────────────────
alter table engagement_items
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists status text not null default 'open' check (status in ('open', 'resolved')),
  add column if not exists sent_body text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Supporting indexes for the status-aware time-bound query pattern
--    (`WHERE status IN ('open','pending') OR received_at > now() -
--    interval '90 days'`, used by listConversations / getConversationThread
--    / the assign-resolve bulk-update candidate fetch in Phase 2) and for
--    grouping rows into a virtual conversation by (tenant, platform, handle).
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_inbound_messages_tenant_status
  on inbound_messages(tenant_slug, status, received_at desc);

create index if not exists idx_inbound_messages_platform_handle
  on inbound_messages(tenant_slug, platform, from_handle);

create index if not exists idx_engagement_items_tenant_status
  on engagement_items(tenant_slug, status, received_at desc);

create index if not exists idx_engagement_items_platform_handle
  on engagement_items(tenant_slug, platform, from_handle);
