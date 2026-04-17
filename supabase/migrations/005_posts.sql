-- PULSE Posts (post-history)
-- Phase 3: published posts per tenant, RLS gated to tenant members

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  title text not null,
  platform text not null check (platform in ('instagram', 'tiktok', 'twitter', 'linkedin')),
  content_type text not null check (content_type in ('video', 'image', 'carousel', 'text')),
  posted_at date not null,
  reach int not null default 0 check (reach >= 0),
  impressions int not null default 0 check (impressions >= 0),
  likes int not null default 0 check (likes >= 0),
  comments int not null default 0 check (comments >= 0),
  shares int not null default 0 check (shares >= 0),
  saves int not null default 0 check (saves >= 0),
  post_url text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_posts_tenant on posts(tenant_slug);
create index if not exists idx_posts_tenant_posted on posts(tenant_slug, posted_at desc);

alter table posts enable row level security;

drop policy if exists "members access posts" on posts;
create policy "members access posts" on posts
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists posts_set_updated_at on posts;
create trigger posts_set_updated_at
  before update on posts
  for each row execute function public.touch_posts_updated_at();
