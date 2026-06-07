-- PULSE: blog publish completeness — `question` field + blog-assets bucket.
--
-- gruveBlog (Contentful) REQUIRES `question` (a sub-heading / FAQ-style hook)
-- in addition to title/slug/content/bannerImage/thumbnail/authorImage. The
-- mapper has a fallback, but this lets editors set it explicitly. cover_image,
-- thumbnail (jsonb), author_image, author, read_minutes already exist (043/048).

alter table blog_posts
  add column if not exists question text;

-- Storage bucket for blog banner/thumbnail/author images. Public read (these
-- are public content + Contentful fetches them by URL at publish time).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'blog-assets',
  'blog-assets',
  true,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public read (Contentful + the rendered blog need the URL).
drop policy if exists "blog-assets public read" on storage.objects;
create policy "blog-assets public read" on storage.objects
  for select using (bucket_id = 'blog-assets');

-- Any authenticated user (a tenant member) can upload/manage blog assets.
drop policy if exists "blog-assets auth insert" on storage.objects;
create policy "blog-assets auth insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'blog-assets');

drop policy if exists "blog-assets auth update" on storage.objects;
create policy "blog-assets auth update" on storage.objects
  for update to authenticated
  using (bucket_id = 'blog-assets')
  with check (bucket_id = 'blog-assets');

drop policy if exists "blog-assets auth delete" on storage.objects;
create policy "blog-assets auth delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'blog-assets');
