-- SEO module Phase 0: extend blog_posts with the columns needed to
-- carry a draft through review → publish lifecycle.
--
-- Correction over the original eng-review plan: extend `blog_posts`
-- (the production blog editor's backing table, migration 015), NOT
-- `content_briefs`. Briefs are intel-card-triggered angles that feed
-- INTO blog_posts; the blog-writer at /seo-tracker/blog-writer/[id]
-- reads and writes blog_posts. content_briefs stays its own thing.
--
-- blog_posts already has title, target_keyword, secondary_keywords,
-- meta_description, outline jsonb, content (markdown), word_count,
-- status, generator_model, generator_cost_usd, updated_at trigger.
-- We add the SEO-specific lifecycle columns on top.
--
-- Status state machine after this migration:
--
--   draft ──submit──▶ in_review ──approve──▶ seo_approved
--      ▲                  │                       │
--      └─request_changes──┘                       │
--                                                 ▼
--   publish_failed ◀──fail── publishing ◀─pub── scheduled
--      │                         │                ▲
--      └─retry──────────────────┴──success──▶ published
--                                                  │
--      archived (admin only) ◀────────────────────┘
--
-- All transitions flow through transition_blog_post_status RPC in 044.

alter table blog_posts
  add column if not exists body_rich_text       jsonb,
  add column if not exists cover_image          jsonb,
  add column if not exists inline_images        jsonb not null default '[]'::jsonb,
  add column if not exists seo_meta_title       text,
  add column if not exists seo_meta_description text,
  add column if not exists canonical_override   text,
  add column if not exists json_ld_blocks       jsonb not null default '[]'::jsonb,
  add column if not exists scheduled_at         timestamptz,
  add column if not exists published_at         timestamptz,
  add column if not exists contentful_entry_id  text,
  add column if not exists contentful_version   int,
  add column if not exists seo_score            int,
  add column if not exists last_error           jsonb,
  add column if not exists publish_run_id       uuid,
  add column if not exists version              int  not null default 1,
  add column if not exists brief_id             uuid references content_briefs(id) on delete set null;

-- Idempotency: a Contentful entry maps to exactly one blog_post.
create unique index if not exists uq_blog_posts_contentful_entry
  on blog_posts(contentful_entry_id)
  where contentful_entry_id is not null;

-- Status: extend the existing check (was draft|editing|review|published|archived
-- per migration 015) with the SEO state machine values. Keep all
-- legacy values for back-compat with existing rows.
alter table blog_posts drop constraint if exists blog_posts_status_check;
alter table blog_posts add constraint blog_posts_status_check
  check (status in (
    'draft',          -- author working
    'editing',        -- legacy from migration 015
    'review',         -- legacy alias for in_review
    'in_review',
    'seo_approved',
    'scheduled',
    'publishing',
    'published',
    'publish_failed',
    'archived'
  ));

-- Pipeline list query: tenant + status + recency.
create index if not exists idx_blog_posts_tenant_status
  on blog_posts(tenant_slug, status, updated_at desc);

-- Author/reviewer lookups.
create index if not exists idx_blog_posts_brief
  on blog_posts(brief_id) where brief_id is not null;
