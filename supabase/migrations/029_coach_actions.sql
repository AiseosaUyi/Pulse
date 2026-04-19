-- Slice 5 — AI Coach. The brain that turns every score into a
-- prioritized action. Each row is "do this next" advice synthesized
-- from blog scores, platform scores, keyword gaps, intel signals,
-- or the weekly digest. Status advances as the user works through
-- them; dismissed and done rows are kept for telemetry.

create table if not exists coach_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  -- What the action was generated from. `source_id` is intentionally
  -- free-text so we can link to blog_posts / scheduled_posts /
  -- keyword_rankings / etc. without a fan of FKs.
  source_type text not null
    check (source_type in (
      'blog_score',
      'platform_score',
      'keyword_gap',
      'intel_signal',
      'weekly_digest',
      'competitor_move',
      'distribution_gap',
      'generic'
    )),
  source_id text,
  title text not null,
  description text not null,
  /** Free-text area tag the user sees ("SEO", "Content Machine", "Outbound"). */
  impact_area text not null default 'general',
  /** 1 = highest (do today), 3 = lowest. */
  priority int not null default 2
    check (priority between 1 and 3),
  status text not null default 'pending'
    check (status in ('pending','in_progress','snoozed','done','dismissed')),
  /** When the action should surface again after a snooze. Null otherwise. */
  snoozed_until timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  /** URL the action links to — usually deep-links into the module
   *  that generated it so the user can start working immediately. */
  action_href text,
  /** Suggested first step label rendered on the CTA button. */
  cta_label text default 'Start',
  created_by_ai boolean not null default true,
  generator_model text,
  generator_cost_usd numeric(8,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_coach_actions_tenant_status
  on coach_actions(tenant_slug, status, priority, created_at desc);

create index if not exists idx_coach_actions_source
  on coach_actions(tenant_slug, source_type, source_id);

alter table coach_actions enable row level security;

drop policy if exists "members access coach_actions" on coach_actions;
create policy "members access coach_actions" on coach_actions
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_coach_actions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists coach_actions_set_updated_at on coach_actions;
create trigger coach_actions_set_updated_at
  before update on coach_actions
  for each row execute function public.touch_coach_actions_updated_at();
