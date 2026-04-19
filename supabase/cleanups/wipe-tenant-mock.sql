-- Wipe seeded mock data for a single tenant so dashboards show honest
-- empty states instead of fake numbers. Run this in the Supabase SQL
-- Editor. Replace every 'gruve' literal below with the tenant slug
-- you want to clean, then run.
--
-- What gets wiped:
--   posts              — seeded post-history rows
--   engagement_items   — seeded DMs/comments/mentions
--   leads              — pre-outbound mock leads
--   campaigns          — seeded ad campaigns
--   tenants.platforms  — reset to []
--
-- What's preserved:
--   Tenant row, memberships, profiles, brand_voice, brand_positioning
--   AI-generated content (blog_posts, content_briefs)
--   Real scraped data (intel_cards, trend_scouts)
--   Outbound pipeline (prospects, outbound_dms)
--   Coach actions, weekly digests, AI call log
--
-- Re-run at will. Idempotent.

begin;

delete from posts             where tenant_slug = 'gruve';
delete from engagement_items  where tenant_slug = 'gruve';
delete from leads             where tenant_slug = 'gruve';
delete from campaigns         where tenant_slug = 'gruve';

update tenants
set platforms = '[]'::jsonb
where slug = 'gruve';

commit;
