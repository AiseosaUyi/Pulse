-- 070_seo_publish_target.sql
-- Per-run publish target so a single Pulse deployment can publish a post to
-- either the LIVE Contentful environment (master → www) or the TEST environment
-- (Production → gamma), chosen per publish in the editor. Stored on the run so
-- durable resume and the runs UI stay consistent with the target the run began
-- with. Existing rows + the default are 'live' (unchanged behaviour).
alter table seo_publish_runs
  add column if not exists target text not null default 'live';

alter table seo_publish_runs
  drop constraint if exists seo_publish_runs_target_check;
alter table seo_publish_runs
  add constraint seo_publish_runs_target_check check (target in ('live', 'test'));
