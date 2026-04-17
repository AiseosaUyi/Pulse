-- Scheduled posts: the calendar layer on top of content_briefs. A brief
-- can be scheduled to one or more platforms on specific days. We don't
-- actually publish (that requires platform integrations) — this tracks
-- intent + draft state so the calendar and feed reflect what's coming.

create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  brief_id uuid references content_briefs(id) on delete set null,
  platform text not null,
  content_type text,
  caption text,
  best_time text,
  scheduled_for timestamptz not null,
  status text not null default 'draft',
  -- 'draft' | 'scheduled' | 'posted' | 'dismissed'
  posted_post_id uuid references posts(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_posts_tenant_for
  on scheduled_posts(tenant_slug, scheduled_for);

create index if not exists idx_scheduled_posts_tenant_status
  on scheduled_posts(tenant_slug, status);

alter table scheduled_posts enable row level security;

drop policy if exists "members access scheduled_posts" on scheduled_posts;
create policy "members access scheduled_posts" on scheduled_posts
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_scheduled_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scheduled_posts_set_updated_at on scheduled_posts;
create trigger scheduled_posts_set_updated_at
  before update on scheduled_posts
  for each row execute function public.touch_scheduled_posts_updated_at();
