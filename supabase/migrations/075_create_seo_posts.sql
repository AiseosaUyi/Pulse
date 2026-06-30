-- Create seo_posts table (lightweight post index used by write_post_index publish step)
create table if not exists seo_posts (
  tenant_slug         text not null references tenants(slug) on delete cascade,
  slug                text not null,
  blog_post_id        uuid not null references blog_posts(id) on delete cascade,
  contentful_entry_id text,
  title               text not null,
  published_at        timestamptz not null,
  last_updated_at     timestamptz not null default now(),
  taxonomy            jsonb,
  primary key (tenant_slug, slug)
);

create index if not exists idx_seo_posts_blog_post on seo_posts(blog_post_id);
create index if not exists idx_seo_posts_published
  on seo_posts(tenant_slug, published_at desc);

alter table seo_posts enable row level security;

drop policy if exists "members read seo_posts" on seo_posts;
create policy "members read seo_posts" on seo_posts
  for select using (public.is_tenant_member(tenant_slug));
