-- Phase B — Outbound Template Workshop. Priye's real workflow is
-- "bulk send the same on-voice DM" rather than one-off personalization.
-- This table stores saved templates, the latest AI critique score,
-- and AI-generated variants. One primary template per (tenant,
-- platform) is copied with a single click from the Pipeline tab.

create table if not exists outbound_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  name text not null,
  platform text not null
    check (platform in ('instagram','tiktok','twitter','linkedin','any')),
  body text not null,
  /** Short note on when to use this template. */
  angle text,
  status text not null default 'active'
    check (status in ('active','archived','draft')),
  /** Only one `is_primary = true` per (tenant, platform). Enforced
    by the partial unique index below. */
  is_primary boolean not null default false,
  /** Latest AI score (0-100). Null until scored. */
  score int check (score between 0 and 100),
  /** Last AI critique payload (structured output from score-template). */
  last_critique jsonb,
  last_scored_at timestamptz,
  /** Populated when the template was AI-generated rather than hand-
    authored. */
  generator_model text,
  generator_cost_usd numeric(8,4) not null default 0,
  /** Which template (if any) was the seed for an AI variant. */
  parent_template_id uuid references outbound_templates(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outbound_templates_tenant_status
  on outbound_templates(tenant_slug, status, updated_at desc);

-- Partial unique index: at most one primary template per (tenant, platform).
create unique index if not exists uq_outbound_templates_primary
  on outbound_templates(tenant_slug, platform)
  where is_primary = true;

alter table outbound_templates enable row level security;

drop policy if exists "members access outbound_templates" on outbound_templates;
create policy "members access outbound_templates" on outbound_templates
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_outbound_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists outbound_templates_set_updated_at on outbound_templates;
create trigger outbound_templates_set_updated_at
  before update on outbound_templates
  for each row execute function public.touch_outbound_templates_updated_at();
