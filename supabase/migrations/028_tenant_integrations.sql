-- Slice 4 — Publish Loop. Tenant-scoped credentials for real outbound
-- publishing. Ayrshare covers social (X, LinkedIn, Instagram, TikTok,
-- Facebook) with a single profile key. WordPress REST + Ghost Admin
-- API handle the blog side. Resend API key handles email (email blast
-- + newsletter blurb).
--
-- One row per (tenant_slug, provider). Columns marked `secret_*` hold
-- tokens we never surface to the client; RLS restricts reads to
-- owner/admin so members can't exfiltrate them from the browser.

create table if not exists tenant_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  provider text not null
    check (provider in ('ayrshare','wordpress','ghost','resend')),
  -- Non-secret config surfaced to the UI for display/edit.
  config jsonb not null default '{}'::jsonb,
  -- The sensitive material. Never exposed to the client — the
  -- service action masks it on read (renders as "••••••••").
  secret_token text,
  -- Optional secondary secret (e.g. WP app password, separate from
  -- username; Ghost admin key is `id:secret`).
  secret_token_2 text,
  status text not null default 'connected'
    check (status in ('connected','error','disconnected')),
  last_error text,
  last_tested_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, provider)
);

create index if not exists idx_tenant_integrations_tenant
  on tenant_integrations(tenant_slug);

alter table tenant_integrations enable row level security;

-- Read: owners + admins only. Members don't see tokens, not even masked.
drop policy if exists "owners manage tenant_integrations" on tenant_integrations;
create policy "owners manage tenant_integrations" on tenant_integrations
  for all
  using (
    public.tenant_role(tenant_slug) in ('owner','admin')
  )
  with check (
    public.tenant_role(tenant_slug) in ('owner','admin')
  );

create or replace function public.touch_tenant_integrations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenant_integrations_set_updated_at on tenant_integrations;
create trigger tenant_integrations_set_updated_at
  before update on tenant_integrations
  for each row execute function public.touch_tenant_integrations_updated_at();

-- Blog-post publish telemetry — where/when we posted, and the
-- external ID so the UI can link back. Kept separate from blog_posts
-- so re-publishing doesn't stomp history.
create table if not exists blog_publications (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  blog_post_id uuid not null references blog_posts(id) on delete cascade,
  provider text not null
    check (provider in ('wordpress','ghost')),
  external_id text,
  external_url text,
  status text not null default 'published'
    check (status in ('published','draft_pushed','failed')),
  error text,
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now()
);

create index if not exists idx_blog_publications_blog
  on blog_publications(blog_post_id);

alter table blog_publications enable row level security;

drop policy if exists "members access blog_publications" on blog_publications;
create policy "members access blog_publications" on blog_publications
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- Scheduled-post publish telemetry. Ties an existing scheduled_posts
-- row to the Ayrshare response so we can surface the live URL and
-- handle retries/failures without re-posting.
create table if not exists scheduled_post_publications (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  scheduled_post_id uuid not null references scheduled_posts(id) on delete cascade,
  provider text not null default 'ayrshare',
  platform text not null,
  external_id text,
  external_url text,
  status text not null default 'published'
    check (status in ('published','failed')),
  error text,
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now()
);

create index if not exists idx_sp_publications_scheduled
  on scheduled_post_publications(scheduled_post_id);

alter table scheduled_post_publications enable row level security;

drop policy if exists "members access sp_publications" on scheduled_post_publications;
create policy "members access sp_publications" on scheduled_post_publications
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
