-- Scheduled posts: one row per queued or published social post.
-- qstash_message_id tracks the live QStash job so schedule-flush can
-- skip already-enqueued posts and the UI can surface retry state.

create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  connection_id uuid references platform_connections(id) on delete set null,
  platform text not null check (platform in ('x', 'linkedin', 'instagram', 'tiktok', 'youtube')),
  content text not null,
  media_paths text[] not null default '{}',
  scheduled_for timestamptz not null,
  posted_at timestamptz,
  platform_post_id text,
  platform_post_url text,
  status text not null default 'scheduled'
    check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  error_message text,
  -- Which Pulse surface created this post
  source text not null default 'composer'
    check (source in ('composer', 'engage', 'ai-content')),
  source_draft_id uuid references social_drafts(id) on delete set null,
  -- QStash message ID — used by schedule-flush to avoid double-enqueuing
  qstash_message_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Primary scheduler query: due posts that haven't run yet
create index if not exists idx_scheduled_posts_due
  on scheduled_posts(status, scheduled_for)
  where status = 'scheduled';

create index if not exists idx_scheduled_posts_tenant
  on scheduled_posts(tenant_slug, scheduled_for desc);

alter table scheduled_posts enable row level security;

drop policy if exists "members access scheduled_posts" on scheduled_posts;
create policy "members access scheduled_posts"
  on scheduled_posts for all
  using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
