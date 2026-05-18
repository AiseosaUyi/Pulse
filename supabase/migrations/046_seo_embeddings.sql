-- SEO module Phase 0: pgvector + post embeddings.
--
-- Vector(3072) chosen per spec; OpenAI text-embedding-3-large supports
-- dimension reduction via the `dimensions` parameter — if HNSW build
-- cost ever bites (>10K posts in a tenant), drop to 1536 with negligible
-- quality loss. Document the alternative; don't enable it yet.
--
-- Refresh policy: embed only on publish, NOT on every editor save
-- (per eng review §P2). content_hash is for staleness detection by
-- the daily reconcile cron, not live refresh.

create extension if not exists vector;

create table if not exists seo_post_embeddings (
  tenant_slug   text not null references tenants(slug) on delete cascade,
  blog_post_id  uuid not null references blog_posts(id) on delete cascade,
  slug          text not null,
  content_hash  text not null,           -- sha256 of normalized body text
  embedding     vector(3072) not null,
  model         text not null default 'openai/text-embedding-3-large',
  dimensions    int  not null default 3072,
  embedded_at   timestamptz not null default now(),
  primary key (tenant_slug, slug)
);

-- HNSW cosine index. Build cost grows roughly linearly with dimension
-- count; at 3072 + low thousands of rows this is fine for years.
create index if not exists idx_seo_post_embeddings_hnsw
  on seo_post_embeddings
  using hnsw (embedding vector_cosine_ops);

create index if not exists idx_seo_post_embeddings_blog_post
  on seo_post_embeddings(blog_post_id);

-- Staleness sweep: WHERE content_hash != current_hash(brief_id)
create index if not exists idx_seo_post_embeddings_tenant_embedded
  on seo_post_embeddings(tenant_slug, embedded_at);

alter table seo_post_embeddings enable row level security;

drop policy if exists "members read embeddings" on seo_post_embeddings;
create policy "members read embeddings" on seo_post_embeddings
  for select using (public.is_tenant_member(tenant_slug));
-- Writes are service-role only (post-publish embedder).

-- Published-post index (lightweight projection over content_briefs
-- for cross-tenant analytical queries that don't need the full brief
-- payload). Mirrors what the spec called `seo_posts`.
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
