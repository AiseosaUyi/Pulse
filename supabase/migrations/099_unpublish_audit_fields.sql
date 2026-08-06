-- Audit fields for unpublished blog posts (preserves author, timestamps, history).
-- See Stage 1 content safety requirement 1.

alter table blog_posts
  add column if not exists unpublished_at timestamptz,
  add column if not exists unpublished_by uuid references auth.users(id) on delete set null,
  add column if not exists unpublish_reason text;
