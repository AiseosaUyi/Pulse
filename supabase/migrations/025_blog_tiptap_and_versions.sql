-- Phase D: WYSIWYG editor, version history, feedback loop.
--
--   blog_posts.content_json — TipTap JSON doc. Markdown `content`
--     column is kept as an export mirror so anything that reads
--     markdown (SEO preview, RSS, external publishers) still works.
--     On first edit of a pre-D post, client lazily generates JSON
--     from markdown and persists it here.
--
--   blog_post_versions — every save creates a new row. Lets users
--     see history + revert. Denormalizes tenant_slug so RLS can use
--     the same is_tenant_member() helper without a join.
--
--   blog_post_feedback — text or voice notes the user leaves for the
--     AI. Audio uploaded to Supabase Storage (`blog-feedback-audio`
--     bucket, tenant-scoped prefix). Transcription cached here.
--     source_version_id records what the user was reviewing.
--     resulting_version_id is set after applyFeedback writes the
--     revised draft.

alter table blog_posts
  add column if not exists content_json jsonb;

create table if not exists blog_post_versions (
  id uuid primary key default gen_random_uuid(),
  blog_post_id uuid not null references blog_posts(id) on delete cascade,
  tenant_slug text not null references tenants(slug) on delete cascade,
  version_number int not null,
  content_json jsonb,
  content_markdown text,
  word_count int not null default 0,
  content_score int,
  diff_summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (blog_post_id, version_number)
);

create index if not exists idx_blog_post_versions_post
  on blog_post_versions(blog_post_id, version_number desc);

alter table blog_post_versions enable row level security;

drop policy if exists "members access blog_post_versions" on blog_post_versions;
create policy "members access blog_post_versions" on blog_post_versions
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create table if not exists blog_post_feedback (
  id uuid primary key default gen_random_uuid(),
  blog_post_id uuid not null references blog_posts(id) on delete cascade,
  tenant_slug text not null references tenants(slug) on delete cascade,
  feedback_text text,
  feedback_audio_path text,
  transcription text,
  source_version_id uuid references blog_post_versions(id) on delete set null,
  resulting_version_id uuid references blog_post_versions(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index if not exists idx_blog_post_feedback_post
  on blog_post_feedback(blog_post_id, created_at desc);

alter table blog_post_feedback enable row level security;

drop policy if exists "members access blog_post_feedback" on blog_post_feedback;
create policy "members access blog_post_feedback" on blog_post_feedback
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
