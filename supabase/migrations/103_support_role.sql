-- Phase 4 of the shared-inbox track: new `support` role, scoped by REAL
-- RLS (not UI-only). See the plan doc, Track A Phase 4 — this scope was
-- escalated during eng review after a verified fact: every tenant-scoped
-- table's RLS policy in this codebase is `for all using
-- (is_tenant_member(tenant_slug))` — full read/write, not read-only. A
-- role literally named "support" that got that same full access via a
-- role check nobody wrote would be a trust-breaking mismatch, not just a
-- scope tradeoff. So this migration is ordered deliberately:
--
--   1. is_support_member() helper (new, mirrors is_tenant_member()).
--   2. RESTRICTIVE policies on every OTHER tenant-scoped business-data
--      table, excluding a support-role member's access to it.
--   3. ONLY THEN widen memberships/invitations.role to allow 'support'.
--
-- Policies gate first; the role that could exploit their absence arrives
-- second. If this migration is ever partially applied, the worst case is
-- "the role doesn't exist yet" — never "the role exists with no fence
-- around it".
--
-- What does NOT get a restrictive policy, and why:
--   - engagement_items, inbound_messages: this is the point of the role.
--     A support agent has to actually work the inbox — same read/write
--     access as every other role, via the existing `is_tenant_member`
--     policies from migrations 008/030. No change to either table here.
--   - tenants: `for select using (is_tenant_member(slug))` (002) is basic
--     tenant identity (name/account_type) needed to render the app shell
--     itself (Sidebar, TenantSwitcher, the (app)/layout.tsx onboarding
--     gate) for EVERY role including support — restricting it would break
--     the app shell, not just hide business data, and it carries no
--     sensitive business data of its own.
--   - profiles: `for select using (true)` (002) is already global-read
--     (display name/avatar only, no email/PII on this table) — needed so
--     a support agent can see who a conversation is assigned to. Writes
--     are already self-row-only (`id = auth.uid()`), independent of role.
--   - memberships: reads are already `user_id = auth.uid() OR
--     is_tenant_member(tenant_slug)` (needed for /settings/team-style
--     member lists elsewhere in the app; support just doesn't have UI to
--     reach that page — see nav-config.ts); writes are already
--     `tenant_role(tenant_slug) = 'owner'`-gated, so a support role was
--     never able to write memberships regardless of this migration.
--   - invitations: already gated to `tenant_role IN ('owner','admin')`
--     for every operation (002) — a support role fails that check
--     already, no new policy needed.
--   - graphic_templates: dropped in migration 062, does not exist.
--
-- Every other `is_tenant_member`-gated table found by grepping every
-- migration in this repo (see the plan doc's explicit instruction to do
-- this sweep) gets a new RESTRICTIVE policy below. RESTRICTIVE policies
-- AND with existing PERMISSIVE ones — they can only ever take access
-- away, never grant it, so this is additive-only and cannot widen any
-- existing role's access.
--
-- Revised after a live run against the dev DB failed on
-- `seo_post_engagement_daily`: `relation "seo_post_engagement_daily" does
-- not exist`. That table genuinely IS defined (049_seo_beacon_rollup.sql)
-- but this repo's migrations are applied by hand per-environment (see
-- CLAUDE.md), so a table a migration *defines* isn't guaranteed to exist
-- everywhere yet — this list was built by grepping migration files, not
-- checking the live schema, so it can't tell the difference. Every table
-- reference below (2a/2b/2c) is now guarded with `to_regclass(...) is
-- null` and skips with a `raise notice` instead of aborting the whole
-- batch — the same class of gap could exist for any other table in this
-- list on this environment, not just the one that happened to fail first.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. is_support_member() helper — mirrors is_tenant_member()'s shape
--    exactly (002_foundation.sql), scoped to role = 'support'.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_support_member(p_slug text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and tenant_slug = p_slug and role = 'support'
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2a. RESTRICTIVE exclusion policies — tenant_slug-keyed tables.
--     One format()-generated policy per table, same DO-block-loop idiom
--     this repo already uses for bulk RLS (see migrations 058, 060).
--     `is_support_member(NULL)` (e.g. global rows on outbound_templates /
--     content_format_templates where tenant_slug is null for
--     global/platform-scope rows) is always false, so those stay visible
--     to every role including support — correct, they're generic
--     non-tenant content, not private business data.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    -- Outbound / CRM
    'leads', 'prospects', 'prospect_searches', 'prospect_notes',
    'outbound_dms', 'outbound_templates', 'outreach_campaigns',
    'conversation_analyses', 'engage_candidates', 'event_scraper_runs',
    -- Content / blog / publishing
    'posts', 'blog_posts', 'blog_post_versions', 'blog_post_feedback',
    'blog_post_ideas', 'saved_content', 'content_distributions',
    'blog_publications', 'scheduled_post_publications', 'scheduled_posts',
    'social_drafts', 'post_log', 'authors', 'content_sections',
    'content_types', 'content_items', 'drive_import_jobs',
    'content_format_templates', 'content_plans', 'programmatic_templates',
    'programmatic_pages', 'topical_maps', 'topical_map_drafts',
    -- SEO
    'keyword_rankings', 'serp_analyses', 'seo_post_embeddings',
    'seo_posts', 'seo_recommendations', 'seo_internal_links',
    'seo_post_engagement_daily', 'seo_publish_runs', 'ai_visibility_daily',
    'gsc_query_daily',
    -- Video
    'video_projects', 'video_assets', 'video_characters',
    'video_generation_runs', 'video_render_jobs',
    -- Ads
    'campaigns', 'ad_accounts', 'ad_creatives', 'ad_campaigns', 'ad_sets',
    'ads', 'ad_insights_daily', 'ad_budget_rule_runs', 'competitor_ads',
    'ad_alerts',
    -- Analytics / attribution
    'web_analytics_daily', 'own_post_metrics', 'analytics_import_sessions',
    'analytics_reports', 'links', 'link_clicks', 'orders', 'order_events',
    'x_signal_cards', 'x_post_ideas_cache',
    -- Intel
    'trend_scouts',
    -- Ops / misc
    'weekly_digests', 'coach_actions', 'cron_runs', 'ai_call_log',
    'content_slots', 'approval_requests', 'platform_connections',
    'broadcast_lists', 'broadcast_list_members', 'broadcast_messages',
    'whatsapp_accounts'
  ]
  loop
    -- This list was built by grepping every migration for is_tenant_member,
    -- not by checking the live DB — and this repo's migrations are applied
    -- by hand per-environment (see CLAUDE.md), so a table a migration
    -- *defines* is not guaranteed to exist on every environment yet. A
    -- missing table here is a pre-existing schema-drift fact about this
    -- environment, not a bug in this migration — skip it rather than abort
    -- the whole batch; there's nothing to restrict on a table that isn't
    -- there, and it'll be covered automatically once that table's own
    -- migration is applied (no re-run of 103 needed).
    if to_regclass('public.' || t) is null then
      raise notice 'support role migration: skipping %, table does not exist on this environment', t;
      continue;
    end if;
    execute format('drop policy if exists "support excluded from %1$s" on %1$I', t);
    execute format(
      'create policy "support excluded from %1$s" on %1$I as restrictive for all using (not public.is_support_member(tenant_slug)) with check (not public.is_support_member(tenant_slug))',
      t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. RESTRICTIVE exclusion policies — tenant_id-keyed tables (the
--     original intel-feed trio retrofitted in 002_foundation.sql /
--     009_intel_feed_rls.sql; every other table in this schema uses
--     tenant_slug, these three alone use tenant_id).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['competitors', 'intel_cards', 'content_briefs']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'support role migration: skipping %, table does not exist on this environment', t;
      continue;
    end if;
    execute format('drop policy if exists "support excluded from %1$s" on %1$I', t);
    execute format(
      'create policy "support excluded from %1$s" on %1$I as restrictive for all using (not public.is_support_member(tenant_id)) with check (not public.is_support_member(tenant_id))',
      t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2c. RESTRICTIVE exclusion policies — join-keyed child tables (no
--     tenant_slug column of their own; gated via their parent run/project
--     row's tenant_slug, same join shape their existing SELECT policies
--     already use).
-- ─────────────────────────────────────────────────────────────────────────────
-- Same existence-guard as 2a/2b — one DO block per child table so a
-- missing child OR parent table skips that pair without aborting the rest.
do $$
begin
  if to_regclass('public.seo_publish_run_steps') is not null and to_regclass('public.seo_publish_runs') is not null then
    execute 'drop policy if exists "support excluded from seo_publish_run_steps" on seo_publish_run_steps';
    execute 'create policy "support excluded from seo_publish_run_steps" on seo_publish_run_steps'
      || ' as restrictive for all using (not exists (select 1 from seo_publish_runs r where r.id = seo_publish_run_steps.run_id and public.is_support_member(r.tenant_slug)))'
      || ' with check (not exists (select 1 from seo_publish_runs r where r.id = seo_publish_run_steps.run_id and public.is_support_member(r.tenant_slug)))';
  else
    raise notice 'support role migration: skipping seo_publish_run_steps, table (or its parent) does not exist on this environment';
  end if;

  if to_regclass('public.event_scraper_run_steps') is not null and to_regclass('public.event_scraper_runs') is not null then
    execute 'drop policy if exists "support excluded from event_scraper_run_steps" on event_scraper_run_steps';
    execute 'create policy "support excluded from event_scraper_run_steps" on event_scraper_run_steps'
      || ' as restrictive for all using (not exists (select 1 from event_scraper_runs r where r.id = event_scraper_run_steps.run_id and public.is_support_member(r.tenant_slug)))'
      || ' with check (not exists (select 1 from event_scraper_runs r where r.id = event_scraper_run_steps.run_id and public.is_support_member(r.tenant_slug)))';
  else
    raise notice 'support role migration: skipping event_scraper_run_steps, table (or its parent) does not exist on this environment';
  end if;

  if to_regclass('public.video_generation_run_steps') is not null and to_regclass('public.video_generation_runs') is not null then
    execute 'drop policy if exists "support excluded from video_generation_run_steps" on video_generation_run_steps';
    execute 'create policy "support excluded from video_generation_run_steps" on video_generation_run_steps'
      || ' as restrictive for all using (not exists (select 1 from video_generation_runs r where r.id = video_generation_run_steps.run_id and public.is_support_member(r.tenant_slug)))'
      || ' with check (not exists (select 1 from video_generation_runs r where r.id = video_generation_run_steps.run_id and public.is_support_member(r.tenant_slug)))';
  else
    raise notice 'support role migration: skipping video_generation_run_steps, table (or its parent) does not exist on this environment';
  end if;

  if to_regclass('public.video_clips') is not null and to_regclass('public.video_projects') is not null then
    execute 'drop policy if exists "support excluded from video_clips" on video_clips';
    execute 'create policy "support excluded from video_clips" on video_clips'
      || ' as restrictive for all using (not exists (select 1 from video_projects p where p.id = video_clips.project_id and public.is_support_member(p.tenant_slug)))'
      || ' with check (not exists (select 1 from video_projects p where p.id = video_clips.project_id and public.is_support_member(p.tenant_slug)))';
  else
    raise notice 'support role migration: skipping video_clips, table (or its parent) does not exist on this environment';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. LAST: widen memberships/invitations role CHECK constraints to allow
--    'support'. Everything above must already be in place before this
--    runs — a role that can be assigned but has no fence around it yet
--    is exactly the mismatch this migration exists to avoid.
--
--    VERIFY BEFORE RUNNING: `memberships_role_check` / `invitations_role_check`
--    are Postgres's default auto-generated name for an unnamed inline
--    `column type check(...)` clause — inferred from the DDL in
--    002_foundation.sql (`role text not null default 'member' check
--    (role in ('owner','admin','member'))`, no explicit CONSTRAINT name
--    given), which Postgres names `<table>_<column>_check` when no name
--    is supplied. Confirm the actual name against the live DB with
--    `\d memberships` / `\d invitations` in the Supabase SQL Editor
--    before running this migration. If it's wrong, `drop constraint if
--    exists` just no-ops (safe) and the `add constraint` below fails
--    loudly with "constraint already exists" rather than silently
--    leaving two constraints in place — but confirm first regardless.
-- ─────────────────────────────────────────────────────────────────────────────
alter table memberships drop constraint if exists memberships_role_check;
alter table memberships
  add constraint memberships_role_check
  check (role in ('owner', 'admin', 'member', 'support'));

alter table invitations drop constraint if exists invitations_role_check;
alter table invitations
  add constraint invitations_role_check
  check (role in ('owner', 'admin', 'member', 'support'));
