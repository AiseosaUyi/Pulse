-- Content brief generator + AI observability.
-- F2 (competitor -> content brief engine) per docs/plan-intelligence-expansion.md.

-- brand_voice lives in tenants.settings jsonb — no schema change.
-- Convention:
--   tenants.settings.brand_voice = {
--     tone, audience, do_list[], dont_list[], example_posts[]
--   }

-- Extend content_briefs with generator metadata + soft-delete columns
alter table content_briefs
  add column if not exists triggered_by_type text
    not null default 'intel_card'
    check (triggered_by_type in ('intel_card','manual')),
  add column if not exists pattern_hash text,
  add column if not exists generator_model text,
  add column if not exists generator_cost_usd numeric(8,4) not null default 0,
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_reason text;

-- Expand status to include 'approved' and 'dismissed'
alter table content_briefs drop constraint if exists content_briefs_status_check;
alter table content_briefs add constraint content_briefs_status_check
  check (status in ('draft','approved','published','dismissed'));

-- Cron idempotency: unique (tenant_id, pattern_hash) when hash is set
create unique index if not exists uq_content_briefs_tenant_pattern
  on content_briefs(tenant_id, pattern_hash)
  where pattern_hash is not null;

-- List-page perf: order by created_at desc per tenant
create index if not exists idx_content_briefs_tenant_created
  on content_briefs(tenant_id, created_at desc);

-- AI call log: per-call cost, latency, cache stats. Writes service-role-only;
-- tenant members read via RLS for future cost dashboard.
create table if not exists ai_call_log (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  purpose text not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(8,4),
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  duration_ms int,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_call_log_tenant_created
  on ai_call_log(tenant_slug, created_at desc);

alter table ai_call_log enable row level security;

drop policy if exists "members read ai_call_log" on ai_call_log;
create policy "members read ai_call_log" on ai_call_log
  for select using (public.is_tenant_member(tenant_slug));
-- Writes are service-role-only: no insert/update/delete policy means default-deny for users.
