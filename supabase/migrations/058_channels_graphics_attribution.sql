-- Phase 3-5 additive schema: WhatsApp broadcast flywheel, brand-graphics
-- templates, and the weekly attribution funnel rollup. Everything here is
-- additive (new tables + nullable columns) so existing paths are untouched.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Weekly attribution rollup (deterministic funnel stored on the digest).
-- ─────────────────────────────────────────────────────────────────────────────
alter table weekly_digests
  add column if not exists attribution_summary jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WhatsApp broadcast flywheel.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists broadcast_lists (
  id          uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  name        text not null,
  description text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_broadcast_lists_tenant
  on broadcast_lists(tenant_slug, created_at desc);

create table if not exists broadcast_list_members (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references broadcast_lists(id) on delete cascade,
  tenant_slug   text not null references tenants(slug) on delete cascade,
  phone         text not null,                 -- E.164, e.g. +234803...
  name          text,
  opted_out     boolean not null default false,
  created_at    timestamptz not null default now()
);

create unique index if not exists uq_broadcast_member
  on broadcast_list_members(list_id, phone);
create index if not exists idx_broadcast_members_tenant
  on broadcast_list_members(tenant_slug);

create table if not exists broadcast_messages (
  id            uuid primary key default gen_random_uuid(),
  tenant_slug   text not null references tenants(slug) on delete cascade,
  list_id       uuid references broadcast_lists(id) on delete set null,
  template_name text,                            -- Meta-approved template id
  body          text not null,
  link_id       uuid references links(id) on delete set null,  -- UTM short link
  status        text not null default 'draft'
                check (status in ('draft','sending','sent','failed')),
  sent_count    int not null default 0,
  failed_count  int not null default 0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

create index if not exists idx_broadcast_messages_tenant
  on broadcast_messages(tenant_slug, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. Per-tenant WhatsApp Cloud API accounts. Inbound webhooks route to a
--     tenant by phone_number_id; outbound sends use that tenant's token. This
--     is what makes WhatsApp multi-tenant (one Meta app, many numbers) instead
--     of a single env-configured number.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists whatsapp_accounts (
  tenant_slug      text primary key references tenants(slug) on delete cascade,
  phone_number_id  text not null unique,          -- routes inbound webhooks
  access_token     text not null,                 -- system-user token (server-only)
  display_phone    text,                           -- human-readable number
  default_template text,                           -- Meta-approved template for broadcasts
  status           text not null default 'connected'
                   check (status in ('connected','error','disconnected')),
  last_error       text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Brand-graphics templates (rendered via next/og at request time).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists graphic_templates (
  tenant_slug text not null references tenants(slug) on delete cascade,
  slug        text not null,                    -- e.g. 'price-drop', 'market-math'
  name        text not null,
  schema      jsonb not null default '{}'::jsonb, -- field definitions the renderer expects
  is_default  boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (tenant_slug, slug)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — member read/write per tenant. WhatsApp inbound webhook + graphics
--    renderer use the service-role client and bypass RLS.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'broadcast_lists','broadcast_list_members','broadcast_messages',
    'graphic_templates','whatsapp_accounts'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "members access %1$s" on %1$I', t);
    execute format(
      'create policy "members access %1$s" on %1$I for all using (public.is_tenant_member(tenant_slug)) with check (public.is_tenant_member(tenant_slug))',
      t
    );
  end loop;
end $$;
