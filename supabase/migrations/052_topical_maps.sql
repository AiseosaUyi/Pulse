-- SEO topical map persistence.
--
-- The topical map was previously recomputed on every "Generate map" click
-- and held only in React state — it vanished on navigation. This table
-- stores the latest AI clustering per tenant so the map survives reloads,
-- and topical_map_drafts records which suggested articles have been turned
-- into real blog_posts drafts (the action that makes the map productive,
-- not just informational).
--
-- One row per tenant (latest map wins) — upsert on tenant_slug.

create table if not exists topical_maps (
  id           uuid primary key default gen_random_uuid(),
  tenant_slug  text not null unique references tenants(slug) on delete cascade,
  clustering   jsonb not null,        -- KeywordClustering: { clusters: [{ name, keywords, intent_summary, suggested_articles }] }
  model        text,                  -- generator model id, for cost/debug
  generated_at timestamptz not null default now()
);

create index if not exists idx_topical_maps_tenant
  on topical_maps(tenant_slug);

-- Links a suggested article (by cluster + title) to the blog_posts draft it
-- spawned, so the map UI can show "drafted / published" status per article.
create table if not exists topical_map_drafts (
  id            uuid primary key default gen_random_uuid(),
  tenant_slug   text not null references tenants(slug) on delete cascade,
  cluster_name  text not null,
  article_title text not null,
  blog_post_id  uuid references blog_posts(id) on delete cascade,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- One draft per (tenant, cluster, article) — clicking "Generate draft" twice
-- on the same article is a no-op rather than a duplicate.
create unique index if not exists uq_topical_map_drafts_article
  on topical_map_drafts(tenant_slug, cluster_name, article_title);

create index if not exists idx_topical_map_drafts_tenant
  on topical_map_drafts(tenant_slug);

alter table topical_maps enable row level security;
alter table topical_map_drafts enable row level security;

drop policy if exists "members access topical_maps" on topical_maps;
create policy "members access topical_maps" on topical_maps
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

drop policy if exists "members access topical_map_drafts" on topical_map_drafts;
create policy "members access topical_map_drafts" on topical_map_drafts
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
