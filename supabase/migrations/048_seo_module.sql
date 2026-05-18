-- SEO module Phase 1: additive top-up for the Contentful `gruveBlog`
-- field map (PULSE-SEO-SPEC.md §5/§11) + the preview-token replay cache
-- (§13). Builds on 043–047; adds only what the map needs that 043 lacks.
--
-- Collision audit (project rule — grepped all prior migrations):
--   * `slug`           — ALREADY on blog_posts via 024_blog_slug_and_preview
--                        (+ unique idx uq_blog_posts_tenant_slug). NOT re-added.
--   * `json_ld_blocks` — 043 has it (generated blocks). `json_ld_overrides`
--                        below is a DISTINCT field (manual override → jsonLd).
--   * everything else  — new.
--
-- Map coverage after this migration (blog_posts → gruveBlog):
--   excerpt→description, author→author, author_image→authorImage,
--   thumbnail→thumbnail, read_minutes→minuteRead, faq_items→faqItems,
--   json_ld_overrides→jsonLd, pulse_metadata→pulseMetadata.
--   (title/slug/body_rich_text/cover_image/seo_meta_*/canonical_override
--    are already present from 015/024/043.)

alter table blog_posts
  add column if not exists excerpt            text,
  add column if not exists author             text,
  add column if not exists author_image       text,
  add column if not exists thumbnail          jsonb,
  add column if not exists read_minutes       int,
  add column if not exists faq_items          jsonb not null default '[]'::jsonb,
  add column if not exists json_ld_overrides  jsonb,
  add column if not exists pulse_metadata     jsonb;

-- ── Preview-token replay cache (PULSE-SEO-SPEC.md §13) ────────────────
-- Each minted preview JWT records its jti here. A jti seen again inside
-- its window is a replay and is rejected. Rows are swept by the
-- preview-jti cron once expired (§16). Tenant-agnostic, short-lived,
-- written/read server-side via the admin client only — RLS enabled with
-- NO policy so it is service-role-only (same posture as cron_runs/047).
create table if not exists seo_preview_jti (
  jti        text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_seo_preview_jti_expires
  on seo_preview_jti(expires_at);

alter table seo_preview_jti enable row level security;
-- (intentionally no policy: only the service-role/admin client touches this)
