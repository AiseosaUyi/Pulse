-- Blog ideation flow (mirrors the video-script ideation pattern in
-- content_plans). The user picks a blog type → AI generates 3
-- candidate ideas (title + premise + keyword) → user picks one →
-- full post generation kicks off.
--
-- For type='feature_announcement' the user supplies feature_meta
-- (name, description, audience, benefits) and the AI generates 1
-- idea instead of 3 — the inputs are too specific to brainstorm
-- around.

alter table blog_posts
  add column if not exists blog_type text,
  add column if not exists blog_idea_id uuid,
  add column if not exists feature_meta jsonb;

-- ── blog_post_ideas ──────────────────────────────────────────
-- Ephemeral ideation candidates. A batch lives until the user picks
-- one (status='picked') or dismisses it (status='dismissed'). The
-- picked idea's id stamps the resulting blog_post via blog_idea_id.

create table if not exists blog_post_ideas (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  batch_id uuid not null,
  blog_type text not null,
  title text not null,
  premise text not null,
  target_keyword text,
  secondary_keywords text[] not null default '{}',
  angle text,
  trending_signal text,
  feature_meta jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'picked', 'dismissed')),
  generator_model text,
  generator_cost_usd numeric(10, 6),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_blog_post_ideas_tenant_status
  on blog_post_ideas(tenant_slug, status, created_at desc);

create index if not exists idx_blog_post_ideas_batch
  on blog_post_ideas(batch_id);

-- updated_at trigger (matches convention from prior migrations)
create or replace function blog_post_ideas_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_blog_post_ideas_updated_at on blog_post_ideas;
create trigger trg_blog_post_ideas_updated_at
  before update on blog_post_ideas
  for each row execute function blog_post_ideas_set_updated_at();

-- RLS — same gating as blog_posts: tenant members can read+write.
alter table blog_post_ideas enable row level security;

drop policy if exists blog_post_ideas_select on blog_post_ideas;
create policy blog_post_ideas_select on blog_post_ideas
  for select using (is_tenant_member(tenant_slug));

drop policy if exists blog_post_ideas_insert on blog_post_ideas;
create policy blog_post_ideas_insert on blog_post_ideas
  for insert with check (is_tenant_member(tenant_slug));

drop policy if exists blog_post_ideas_update on blog_post_ideas;
create policy blog_post_ideas_update on blog_post_ideas
  for update using (is_tenant_member(tenant_slug));

drop policy if exists blog_post_ideas_delete on blog_post_ideas;
create policy blog_post_ideas_delete on blog_post_ideas
  for delete using (is_tenant_member(tenant_slug));
