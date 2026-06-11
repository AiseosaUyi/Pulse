-- Phase 1-2 spine: post→order attribution + the engagement-sync bug fix +
-- reply-approval and promo-offer schema.
--
-- Why: as of 2026-06-10 nothing Pulse publishes is traceable to an order, and
-- the composio-sync-engagement cron upserts external_id/meta columns that never
-- existed on engagement_items (it would silently fail the moment IG connects).
-- This migration adds the attribution tables (links/link_clicks/orders/
-- order_events), UTM columns on the publish path, the missing engagement_items
-- columns + idempotency key, approval-queue columns, and promo-offer fields.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Publish path: UTM tags + external id / live url persistence
-- ─────────────────────────────────────────────────────────────────────────────
alter table posts
  add column if not exists external_id  text,          -- platform media id (IG mediaId, etc.)
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content  text;

alter table scheduled_posts
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content  text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. engagement_items: fix the sync bug (missing columns + idempotency) +
--    reply-approval queue columns.
-- ─────────────────────────────────────────────────────────────────────────────
alter table engagement_items
  add column if not exists external_id     text,                          -- composio comment/message id
  add column if not exists meta            jsonb,                         -- { media_id, parent_id, conversation_id, sender_id }
  add column if not exists source          text not null default 'manual',-- 'manual' (typed in) | 'composio' (synced)
  add column if not exists ai_draft        jsonb,                         -- { body, confidence, tone }
  add column if not exists approval_status text,
  add column if not exists approved_by     uuid references auth.users(id) on delete set null,
  add column if not exists approved_at     timestamptz;

alter table engagement_items
  drop constraint if exists engagement_items_approval_status_check;
alter table engagement_items
  add constraint engagement_items_approval_status_check
  check (approval_status is null
         or approval_status in ('pending_review','approved','rejected','sent'));

-- Full (non-partial) unique index so the cron's
-- onConflict: "tenant_slug,platform,external_id" can infer it. NULL external_id
-- rows (manual entries) stay allowed because Postgres treats NULLs as distinct.
create unique index if not exists uq_engagement_items_external
  on engagement_items(tenant_slug, platform, external_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. inbound_messages: reply-approval queue columns (shared inbox surface).
-- ─────────────────────────────────────────────────────────────────────────────
alter table inbound_messages
  add column if not exists channel         text not null default 'instagram',
  add column if not exists ai_draft        jsonb,
  add column if not exists approval_status text,
  add column if not exists approved_by     uuid references auth.users(id) on delete set null,
  add column if not exists approved_at     timestamptz;

alter table inbound_messages
  drop constraint if exists inbound_messages_approval_status_check;
alter table inbound_messages
  add constraint inbound_messages_approval_status_check
  check (approval_status is null
         or approval_status in ('pending_review','approved','rejected','sent'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trackable short links + click log.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists links (
  id                uuid primary key default gen_random_uuid(),
  tenant_slug       text not null references tenants(slug) on delete cascade,
  code              text not null unique,                    -- short code in /r/:code
  post_id           uuid references posts(id) on delete set null,
  scheduled_post_id uuid references scheduled_posts(id) on delete set null,
  destination_url   text not null,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_links_tenant on links(tenant_slug, created_at desc);
create index if not exists idx_links_post on links(post_id) where post_id is not null;

create table if not exists link_clicks (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references links(id) on delete cascade,
  tenant_slug text not null references tenants(slug) on delete cascade,  -- denormalized for RLS + reporting
  clicked_at  timestamptz not null default now(),
  user_agent  text,
  referer     text,
  ip_hash     text                                                       -- hashed, never raw IP
);

create index if not exists idx_link_clicks_link on link_clicks(link_id, clicked_at desc);
create index if not exists idx_link_clicks_tenant on link_clicks(tenant_slug, clicked_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Commerce signal: orders + order events. The north-star spine.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists orders (
  id           uuid primary key default gen_random_uuid(),
  tenant_slug  text not null references tenants(slug) on delete cascade,
  external_id  text,                                          -- store/checkout id (idempotency)
  source       text,                                          -- free-form: campaign / broadcast / 'manual'
  channel      text not null default 'web'
               check (channel in ('web','whatsapp','dm','phone')),
  utm_campaign text,
  utm_content  text,
  amount       numeric(12,2),
  currency     text not null default 'NGN',
  status       text not null default 'created'
               check (status in ('created','paid','fulfilled','refunded','cancelled')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- NULL external_id (manual orders) allowed; webhook upserts infer this index.
create unique index if not exists uq_orders_external on orders(tenant_slug, external_id);
create index if not exists idx_orders_tenant_created on orders(tenant_slug, created_at desc);
create index if not exists idx_orders_campaign on orders(tenant_slug, utm_campaign) where utm_campaign is not null;

create table if not exists order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  tenant_slug text not null references tenants(slug) on delete cascade,   -- denormalized for RLS
  event       text not null,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_order_events_order on order_events(order_id, created_at desc);

create or replace function orders_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
  before update on orders
  for each row execute function orders_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Promo / offer fields on the content surface.
-- ─────────────────────────────────────────────────────────────────────────────
alter table content_items
  add column if not exists offer_headline text,
  add column if not exists price          numeric(10,2),
  add column if not exists discount       numeric(5,2),
  add column if not exists cta_url        text,
  add column if not exists expires_at     timestamptz;

alter table content_briefs
  add column if not exists offer_headline  text,
  add column if not exists offer_price     numeric(10,2),
  add column if not exists offer_cta_url   text,
  add column if not exists offer_expires_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS for new tables. Member read/write per tenant; the public /r/:code
--    redirect and the orders webhook both use the service-role client, which
--    bypasses RLS — so member policies here are for in-app reads only.
-- ─────────────────────────────────────────────────────────────────────────────
alter table links enable row level security;
drop policy if exists "members access links" on links;
create policy "members access links" on links
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

alter table link_clicks enable row level security;
drop policy if exists "members read link_clicks" on link_clicks;
create policy "members read link_clicks" on link_clicks
  for select using (public.is_tenant_member(tenant_slug));

alter table orders enable row level security;
drop policy if exists "members access orders" on orders;
create policy "members access orders" on orders
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

alter table order_events enable row level security;
drop policy if exists "members read order_events" on order_events;
create policy "members read order_events" on order_events
  for select using (public.is_tenant_member(tenant_slug));
