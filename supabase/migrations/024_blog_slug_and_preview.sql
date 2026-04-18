-- Phase C: blog rows get a URL slug + cached Google SERP preview so
-- the list page can render the SERP-style preview card without
-- recomputing on every render.
--
--   slug — lowercase, hyphenated, tenant-unique. Derived from the
--          title on insert; users can override via the editor.
--   google_preview — denormalized {title_display, url_display,
--          meta_display} so /seo-tracker/blog-writer renders fast.

alter table blog_posts
  add column if not exists slug text,
  add column if not exists google_preview jsonb;

-- Unique per tenant so two drafts can't ship to the same URL. NULL
-- slugs allowed (pre-migration rows). Partial index keeps the
-- constraint out of the way of nulls.
create unique index if not exists uq_blog_posts_tenant_slug
  on blog_posts(tenant_slug, slug)
  where slug is not null;

-- Fast lookup for "is this slug taken?" during the slug-generator
-- collision resolver in the action layer.
create index if not exists idx_blog_posts_tenant_slug_lookup
  on blog_posts(tenant_slug, slug)
  where slug is not null;
