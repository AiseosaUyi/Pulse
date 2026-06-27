-- 071: X (Twitter) social listening
-- Stores per-tenant keyword + account config in tenants.settings (same JSONB
-- pattern as cadence + scout_config). Results land in x_signal_cards.
--
-- x_intel_config shape (in tenants.settings):
-- {
--   "keywords":       ["events", "nightlife", ...],   -- up to 20
--   "accounts":       ["lagosnights", "gruvehq", ...], -- up to 30 (no @)
--   "min_engagement": 15,
--   "enabled":        true
-- }

create table if not exists x_signal_cards (
  id              uuid primary key default gen_random_uuid(),
  tenant_slug     text not null references tenants(slug) on delete cascade,
  signal_type     text not null check (signal_type in ('keyword', 'account_monitor', 'trending')),
  matched_keyword text,        -- which keyword triggered this card (for keyword type)
  account_handle  text,        -- which monitored account (for account_monitor type)
  tweet_id        text not null,
  author_handle   text not null,
  author_name     text,
  author_followers int,
  tweet_text      text not null,
  tweet_url       text not null,
  likes           int  not null default 0,
  reposts         int  not null default 0,
  replies         int  not null default 0,
  posted_at       timestamptz not null,
  detected_at     timestamptz not null default now(),
  dismissed_at    timestamptz,
  dismissed_by    uuid references auth.users(id),
  unique (tenant_slug, tweet_id)
);

alter table x_signal_cards enable row level security;

create policy "tenant members can read x_signal_cards"
  on x_signal_cards for select
  using (is_tenant_member(tenant_slug));

create policy "tenant members can dismiss x_signal_cards"
  on x_signal_cards for update
  using (is_tenant_member(tenant_slug));

-- Service-role INSERT (cron) bypasses RLS automatically, but an explicit policy
-- lets us verify the table is accessible to the admin client in tests.
create policy "service role insert x_signal_cards"
  on x_signal_cards for insert
  with check (true);

create index if not exists x_signal_cards_tenant_detected
  on x_signal_cards (tenant_slug, detected_at desc)
  where dismissed_at is null;
