-- PULSE: SEO / E-E-A-T blog fields (slice 2). Mirrors the gruveBlog Contentful
-- additions so the publish mapper has somewhere to read from.
--   tags          → gruveBlog.tags (Array<Symbol>)  keywords / topical clustering
--   category      → gruveBlog.category              breadcrumbs + landing links
--   author_bio    → gruveBlog.authorBio             Person.description (E-E-A-T)
--   author_title  → gruveBlog.authorTitle           Person.jobTitle
--   author_url    → gruveBlog.authorUrl             Person.url
--   published_date→ gruveBlog.publishedDate         datePublished override
--   updated_date  → gruveBlog.updatedDate           dateModified override
--   noindex       → gruveBlog.noindex               keep out of the index

alter table blog_posts
  add column if not exists tags          text[] not null default '{}',
  add column if not exists category      text,
  add column if not exists author_bio    text,
  add column if not exists author_title  text,
  add column if not exists author_url    text,
  add column if not exists published_date timestamptz,
  add column if not exists updated_date   timestamptz,
  add column if not exists noindex       boolean not null default false;
