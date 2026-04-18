-- Phase B: Brand Positioning + Content Scoring.
--
-- Brand Positioning itself is a JSON blob stored INSIDE the existing
-- `tenants.settings` column alongside `brand_voice` — see
-- `src/lib/ai/brand-positioning.ts` for the Zod schema. No dedicated
-- column needed. Existing `updateBrandVoice` merge pattern
-- (src/lib/actions/briefs.ts:185-191) preserves `brand_positioning`
-- when voice updates, and vice-versa.
--
-- New per-post columns carry the score output + issues so the side
-- panel UI (Phase C) can render everything without re-scoring on
-- every render.

alter table blog_posts
  add column if not exists content_score int,
  add column if not exists sub_scores jsonb,
  add column if not exists score_issues jsonb not null default '[]',
  add column if not exists score_warning boolean not null default false,
  add column if not exists faq_schema jsonb,
  add column if not exists generation_status text not null default 'ready';

-- generation_status is a parallel lifecycle column — existing editorial
-- `status` (draft/editing/review/published/archived) stays untouched.
alter table blog_posts drop constraint if exists blog_posts_generation_status_check;
alter table blog_posts add constraint blog_posts_generation_status_check
  check (generation_status in ('pending','generating','scoring','ready','failed'));

create index if not exists idx_blog_posts_tenant_score
  on blog_posts(tenant_slug, content_score desc)
  where content_score is not null;

create index if not exists idx_blog_posts_tenant_generation_status
  on blog_posts(tenant_slug, generation_status)
  where generation_status <> 'ready';

-- Per-feature cost analytics. Every logAiCall() site will set `feature`
-- (blog_generate / blog_score_<subscore> / serp_analyze / etc.) so we
-- can slice /settings/ai-usage by capability, not just model.
alter table ai_call_log
  add column if not exists feature text;

create index if not exists idx_ai_call_log_tenant_feature
  on ai_call_log(tenant_slug, feature, created_at desc)
  where feature is not null;
