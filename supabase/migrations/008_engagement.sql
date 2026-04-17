-- PULSE Engagement Inbox
-- Phase 3: inbound DMs / comments / mentions / replies per tenant

create table if not exists engagement_items (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  type text not null check (type in ('dm', 'comment', 'mention', 'reply')),
  platform text not null check (platform in ('instagram', 'tiktok', 'twitter', 'linkedin')),
  from_name text not null,
  from_handle text,
  from_avatar text,
  content text not null,
  post_title text,
  external_url text,
  received_at timestamptz not null default now(),
  read boolean not null default false,
  replied boolean not null default false,
  sentiment text not null default 'neutral' check (sentiment in ('positive', 'neutral', 'negative', 'question')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_engagement_items_tenant on engagement_items(tenant_slug);
create index if not exists idx_engagement_items_tenant_received on engagement_items(tenant_slug, received_at desc);
create index if not exists idx_engagement_items_tenant_unread on engagement_items(tenant_slug, read) where read = false;

alter table engagement_items enable row level security;

drop policy if exists "members access engagement_items" on engagement_items;
create policy "members access engagement_items" on engagement_items
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_engagement_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists engagement_items_set_updated_at on engagement_items;
create trigger engagement_items_set_updated_at
  before update on engagement_items
  for each row execute function public.touch_engagement_items_updated_at();
