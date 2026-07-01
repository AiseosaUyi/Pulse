-- 083: own_post_metrics dedup + json_export source
-- Fixes ZIP import: source check didn't include json_export, and there was
-- no unique constraint for the (tenant_slug, platform, captured_at) upsert path.

-- Allow json_export as a source (ZIP data exports)
alter table own_post_metrics drop constraint if exists own_post_metrics_source_check;
alter table own_post_metrics add constraint own_post_metrics_source_check
  check (source in ('csv', 'screenshot', 'manual', 'api', 'json_export'));

-- Remove duplicate rows, keeping the most recent (highest created_at) per group.
-- Required before the unique index can be created.
delete from own_post_metrics
where id in (
  select id from (
    select id,
      row_number() over (
        partition by tenant_slug, platform, captured_at
        order by created_at desc, id desc
      ) as rn
    from own_post_metrics
    where scheduled_post_id is null
  ) ranked
  where rn > 1
);

-- Unique index for ZIP upsert dedup: one row per tenant+platform+time
-- (non-API rows — API rows dedup on scheduled_post_id+platform via mig 068)
create unique index if not exists idx_own_post_metrics_tenant_platform_captured
  on own_post_metrics(tenant_slug, platform, captured_at)
  where scheduled_post_id is null;
