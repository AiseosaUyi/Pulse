-- SEO module Phase 0: recommendation engine table.
--
-- Recommendation lifecycle:
--
--   generated → surfaced → (applied | dismissed | snoozed) → measured_30d
--
-- The outcome_30d capture is the moat — without it, we can never
-- evaluate which rec types pay off. Shipping the column from day 1
-- (per eng review §10, moved into scope) so we don't lose months of
-- signal.

create table if not exists seo_recommendations (
  id              uuid primary key default gen_random_uuid(),
  tenant_slug     text not null references tenants(slug) on delete cascade,
  blog_post_id    uuid references blog_posts(id) on delete cascade,
  slug            text,                  -- denormalized for queries pre-publish
  type            text not null check (type in (
    'title_rewrite',
    'meta_rewrite',
    'internal_link_add',
    'internal_link_receive',
    'faq_add',
    'schema_add',
    'content_refresh',
    'keyword_capture',
    'decay_alert',
    'backlink_outreach'
  )),
  payload         jsonb not null,        -- type-specific structured suggestion
  score           numeric not null,      -- confidence 0..1; gates surfacing
  status          text not null default 'surfaced' check (status in (
    'surfaced','applied','dismissed','snoozed'
  )),
  surfaced_at     timestamptz not null default now(),
  applied_at      timestamptz,
  dismissed_at    timestamptz,
  snoozed_until   timestamptz,
  baseline_30d    jsonb,                 -- snapshot at apply time (CTR/position/clicks)
  outcome_30d     jsonb,                 -- snapshot 30 days post-apply, with diff
  outcome_due_at  timestamptz,           -- when the daily outcome cron should sample
  reviewer        uuid references auth.users(id) on delete set null,
  created_by_run  uuid,                  -- which detection cron produced this
  notes           text
);

-- Surfaced-list query: WHERE tenant_slug = ? AND status = 'surfaced' ORDER BY score DESC
create index if not exists idx_seo_recs_tenant_status_score
  on seo_recommendations(tenant_slug, status, score desc);

-- Per-post drill-down.
create index if not exists idx_seo_recs_post
  on seo_recommendations(blog_post_id)
  where blog_post_id is not null;

-- Outcome cron sweep: WHERE outcome_due_at <= now() AND outcome_30d IS NULL
create index if not exists idx_seo_recs_outcome_due
  on seo_recommendations(outcome_due_at)
  where outcome_30d is null and applied_at is not null;

-- Dedup: don't surface the same suggestion twice for the same post.
create unique index if not exists uq_seo_recs_post_type_payload_hash
  on seo_recommendations(blog_post_id, type, md5(payload::text))
  where status = 'surfaced' and blog_post_id is not null;

alter table seo_recommendations enable row level security;

drop policy if exists "members read seo_recs" on seo_recommendations;
create policy "members read seo_recs" on seo_recommendations
  for select using (public.is_tenant_member(tenant_slug));

drop policy if exists "admins update seo_recs" on seo_recommendations;
create policy "admins update seo_recs" on seo_recommendations
  for update using (public.tenant_role(tenant_slug) in ('owner','admin','member'))
  with check  (public.tenant_role(tenant_slug) in ('owner','admin','member'));
-- Inserts are service-role-only (cron detection jobs).

-- Crawled internal-link graph. Ground truth for what links exist;
-- embeddings suggest *missing* edges. Populated by a daily crawler
-- against gruve.events/blogs/*.
create table if not exists seo_internal_links (
  tenant_slug   text not null references tenants(slug) on delete cascade,
  from_slug     text not null,
  to_slug       text not null,
  anchor        text,
  observed_at   timestamptz not null default now(),
  primary key (tenant_slug, from_slug, to_slug)
);

create index if not exists idx_seo_internal_links_to
  on seo_internal_links(tenant_slug, to_slug);

alter table seo_internal_links enable row level security;

drop policy if exists "members read internal_links" on seo_internal_links;
create policy "members read internal_links" on seo_internal_links
  for select using (public.is_tenant_member(tenant_slug));

-- Webhook event log (Contentful, Gruve revalidate confirms, etc).
-- Keeps signature_ok separate from processed_at so we can audit failed
-- verification attempts.
create table if not exists seo_webhook_events (
  id           bigserial primary key,
  tenant_slug  text references tenants(slug) on delete set null,
  source       text not null,
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  signature_ok boolean not null default false
);

create index if not exists idx_seo_webhook_events_source_received
  on seo_webhook_events(source, received_at desc);
create index if not exists idx_seo_webhook_events_unprocessed
  on seo_webhook_events(received_at)
  where processed_at is null;

alter table seo_webhook_events enable row level security;

drop policy if exists "owners read webhook_events" on seo_webhook_events;
create policy "owners read webhook_events" on seo_webhook_events
  for select using (
    tenant_slug is not null
    and public.tenant_role(tenant_slug) in ('owner','admin')
  );
-- Service-role inserts only.
