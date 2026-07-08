-- Individual Persona Content Calendar (design doc + eng review, 2026-07-08).
--
-- A "content slot" is one AI-assigned topic + research briefing (talking
-- points, a stat with its source, a contrarian angle, reference links) for
-- a piece of short-form video content. Slots are generated in batches
-- ("Generate my next N") and worked through whenever the founder has free
-- time — dates are provisional, not fixed: `position` (not a calendar date)
-- is the real ordering key, and "next" is computed lazily at read time from
-- position + status, not stored as a mutated date. See the design doc's
-- "ENG REVIEW" section for the full locked-decision rationale — no separate
-- durable-runner/batch-tracking tables were added; batch generation runs
-- synchronously (capped N) rather than needing the checkpointed-run pattern
-- used elsewhere in this repo for genuinely slow multi-minute jobs.

create table if not exists content_slots (
  id                uuid primary key default gen_random_uuid(),
  tenant_slug       text not null references tenants(slug) on delete cascade,
  position          int  not null,
  status            text not null default 'assigned'
                       check (status in ('assigned', 'in_progress', 'filmed', 'posted', 'skipped')),
  topic_title       text not null,
  -- { talkingPoints: string[], stat: string|null, statSourceUrl: string|null,
  --   contrarianAngle: string|null, referenceLinks: {url,title}[],
  --   noReferencesFound: boolean }
  topic_brief       jsonb not null default '{}'::jsonb,
  notes             text,
  video_asset_url   text,
  platforms         text[] not null default '{}',
  retired_reason    text,        -- e.g. 'stale_auto_retired' — set when auto-skipped past the staleness+grace window
  generated_at      timestamptz not null default now(),
  posted_at         timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_content_slots_tenant_position
  on content_slots(tenant_slug, position);
create index if not exists idx_content_slots_tenant_status
  on content_slots(tenant_slug, status);

alter table content_slots enable row level security;

drop policy if exists "members read content_slots" on content_slots;
create policy "members read content_slots" on content_slots
  for select using (public.is_tenant_member(tenant_slug));
-- Writes go through server actions via the admin client (requireUser() +
-- tenant check in code), same convention as scheduled_posts/prospects —
-- no INSERT/UPDATE policy needed for the authenticated-user path.
