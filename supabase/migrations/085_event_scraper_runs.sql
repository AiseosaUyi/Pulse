-- Event Platform Lead Scraper (Outbound add-on).
--
-- Adds per-platform run tracking for the event/ticketing-platform lead-gen
-- pipeline. This did not exist before this migration for ANY platform, old
-- or new: the existing scrape-ticketing-platforms cron writes exactly one
-- cron_runs row per invocation covering every tenant and all 4 Apify-based
-- platforms combined (mig 047) — there is no per-platform breakdown to
-- "reconcile" here, this is genuinely new granularity for both the old
-- Apify-based platforms and the new self-hosted ones.
--
-- `provider` distinguishes the crawl mechanism so the Outbound UI can show
-- both lineages in one place without conflating them:
--   'apify'   — the existing 4 platforms (Jetron, Eventbrite, Luma,
--               Tix.africa), crawled via Apify's website-content-crawler.
--               Untouched by this feature; only their run visibility is new.
--   'inhouse' — new platforms (Shows.ng, eGotickets, etc.), crawled with a
--               self-hosted cheerio-based fetcher. No Apify involved.

create table if not exists event_scraper_runs (
  id                uuid primary key default gen_random_uuid(),
  tenant_slug       text not null references tenants(slug) on delete cascade,
  platform          text not null,               -- e.g. 'shows_ng', 'jetron'
  provider          text not null check (provider in ('apify', 'inhouse')),
  search_id         uuid references prospect_searches(id) on delete set null,
  status            text not null check (status in ('running', 'succeeded', 'failed', 'partial')),
  trigger           text not null default 'cron' check (trigger in ('cron', 'manual')),
  triggered_by      uuid references auth.users(id) on delete set null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  candidates_found  int not null default 0,
  prospects_created int not null default 0,
  error             jsonb
);

create index if not exists idx_event_scraper_runs_tenant_started
  on event_scraper_runs(tenant_slug, started_at desc);
create index if not exists idx_event_scraper_runs_platform
  on event_scraper_runs(tenant_slug, platform, started_at desc);

create table if not exists event_scraper_run_steps (
  run_id      uuid not null references event_scraper_runs(id) on delete cascade,
  step        text not null,   -- e.g. 'fetch_listing', 'parse_candidates', 'resolve_organizer', 'qualify'
  attempt     int  not null default 1,
  status      text not null check (status in ('ok', 'failed', 'skipped')),
  duration_ms int,
  payload     jsonb,
  error       jsonb,
  recorded_at timestamptz not null default now(),
  primary key (run_id, step, attempt)
);

create index if not exists idx_event_scraper_run_steps_lookup
  on event_scraper_run_steps(run_id, recorded_at desc);

alter table event_scraper_runs      enable row level security;
alter table event_scraper_run_steps enable row level security;

drop policy if exists "members read event_scraper_runs" on event_scraper_runs;
create policy "members read event_scraper_runs" on event_scraper_runs
  for select using (public.is_tenant_member(tenant_slug));

drop policy if exists "members read event_scraper_run_steps" on event_scraper_run_steps;
create policy "members read event_scraper_run_steps" on event_scraper_run_steps
  for select using (
    exists (
      select 1 from event_scraper_runs r
      where r.id = event_scraper_run_steps.run_id
        and public.is_tenant_member(r.tenant_slug)
    )
  );
-- Writes are service-role-only (cron + the manual "Run now" server action).

-- Links a prospect back to the run that (up)inserted it, so the Outbound UI
-- can expand a run and show exactly which prospects it produced. Nullable +
-- on delete set null: deleting a run must never cascade-delete real leads.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS event_scraper_run_id uuid
  REFERENCES event_scraper_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_event_scraper_run
  ON prospects(event_scraper_run_id)
  WHERE event_scraper_run_id IS NOT NULL;

-- New signal_type value for prospects sourced via the self-hosted event
-- scraper — kept distinct from the existing 'ticketing_platform' (Apify)
-- value so the two lineages stay distinguishable in prospect_searches too.
alter table prospect_searches
  drop constraint if exists prospect_searches_signal_type_check;
alter table prospect_searches
  add constraint prospect_searches_signal_type_check
  check (signal_type in (
    'keyword', 'hashtag', 'event_host', 'event_attendee',
    'recent_post', 'manual', 'ticketing_platform', 'platform_discovery',
    'event_platform_scraper'
  ));
