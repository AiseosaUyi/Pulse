-- Slice 3 — Content Machine. One blog post → N distribution artifacts
-- (twitter thread, linkedin post, instagram carousel script, tiktok
-- hook, email, newsletter blurb, reddit comment, youtube short).
-- The AI generator writes rows with status='draft'; the distribute
-- dialog lets the user approve/edit/schedule each.

create table if not exists content_distributions (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  blog_post_id uuid not null references blog_posts(id) on delete cascade,
  format text not null
    check (format in (
      'twitter_thread',
      'linkedin_post',
      'instagram_carousel',
      'tiktok_hook',
      'email',
      'newsletter',
      'reddit_comment',
      'youtube_short'
    )),
  content text not null,
  status text not null default 'draft'
    check (status in ('draft','approved','scheduled','published','dismissed')),
  scheduled_at timestamptz,
  generator_model text,
  generator_cost_usd numeric(8,4) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_content_distributions_blog_post
  on content_distributions(blog_post_id);

create index if not exists idx_content_distributions_tenant_status
  on content_distributions(tenant_slug, status);

alter table content_distributions enable row level security;

drop policy if exists "members access content_distributions" on content_distributions;
create policy "members access content_distributions" on content_distributions
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_content_distributions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists content_distributions_set_updated_at on content_distributions;
create trigger content_distributions_set_updated_at
  before update on content_distributions
  for each row execute function public.touch_content_distributions_updated_at();
