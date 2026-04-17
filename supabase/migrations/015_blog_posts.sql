-- SEO blog posts — AI-generated drafts grounded in brand voice + tracked keywords.
-- Per-tenant, RLS-gated. Content stored as markdown.

create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  title text not null,
  target_keyword text,
  secondary_keywords text[] default '{}',
  meta_description text,
  outline jsonb not null default '[]',
  -- outline shape: array of { heading: string, bullets: string[] }
  content text,
  word_count int not null default 0,
  status text not null default 'draft'
    check (status in ('draft','editing','review','published','archived')),
  generator_model text,
  generator_cost_usd numeric(8,4) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_blog_posts_tenant_updated
  on blog_posts(tenant_slug, updated_at desc);

alter table blog_posts enable row level security;

drop policy if exists "members access blog_posts" on blog_posts;
create policy "members access blog_posts" on blog_posts
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_blog_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists blog_posts_set_updated_at on blog_posts;
create trigger blog_posts_set_updated_at
  before update on blog_posts
  for each row execute function public.touch_blog_posts_updated_at();
