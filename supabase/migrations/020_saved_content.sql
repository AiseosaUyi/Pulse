-- Content vault: the user's pile of reference content (competitor reels,
-- memes to edit, trending formats) they want to save for future use. One
-- row per saved asset, tagged + tied to a source (external URL or intel
-- card) so we can surface "where did this come from" later.

create table if not exists saved_content (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  title text not null,
  source_platform text,
  -- 'tiktok' | 'instagram' | 'twitter' | 'youtube' | 'manual' | 'intel_card' | 'trend_scout'
  source_url text,
  intel_card_id uuid references intel_cards(id) on delete set null,
  trend_scout_id uuid references trend_scouts(id) on delete set null,
  thumbnail_emoji text,
  notes text,
  tags text[] not null default '{}',
  best_for text[] not null default '{}',
  -- 'reel' | 'story' | 'post' | 'blog' | etc.
  status text not null default 'new',
  -- 'new' | 'scheduled' | 'used' | 'archived'
  saved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_saved_content_tenant_status
  on saved_content(tenant_slug, status, updated_at desc);

create index if not exists idx_saved_content_tenant_updated
  on saved_content(tenant_slug, updated_at desc);

alter table saved_content enable row level security;

drop policy if exists "members access saved_content" on saved_content;
create policy "members access saved_content" on saved_content
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_saved_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists saved_content_set_updated_at on saved_content;
create trigger saved_content_set_updated_at
  before update on saved_content
  for each row execute function public.touch_saved_content_updated_at();
