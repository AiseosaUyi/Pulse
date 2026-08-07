-- Manual blog authoring: per-section scratch state for the section-builder
-- UI (src/app/(app)/(intelligence)/seo-tracker/blog-writer/[id]/sections).
-- Shape: array of { id, kind: "intro"|"body"|"conclusion", heading, content }.
-- Null for AI-generated posts (they never populate this) and for manual
-- posts once "Compile draft" has folded the sections into the normal
-- `content`/`content_json` blob every other part of the app already reads.
alter table blog_posts
  add column if not exists draft_sections jsonb;
