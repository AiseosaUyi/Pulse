-- Programmatic SEO: template-driven page generation. One template captures
-- the title/url/content pattern and the variable values; pages are the
-- expanded rows (e.g. template "{eventType} in {city}" × 5 cities × 4
-- eventTypes = 20 pages). Regenerating a page overwrites body_md.

create table if not exists programmatic_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  name text not null,
  title_pattern text not null,
  url_pattern text not null,
  meta_description_pattern text,
  content_prompt text not null,
  target_word_count int not null default 600,
  variables jsonb not null default '[]',
  -- shape: [{ name: string, values: string[] }]
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_programmatic_templates_tenant
  on programmatic_templates(tenant_slug, updated_at desc);

create table if not exists programmatic_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  template_id uuid not null references programmatic_templates(id) on delete cascade,
  slug text not null,
  title text not null,
  meta_description text,
  body_md text,
  variables jsonb not null default '{}',
  -- shape: { [variableName]: string }
  status text not null default 'draft',
  -- 'draft' | 'published'
  generator_model text,
  generator_cost_usd numeric(8,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_programmatic_pages_template_slug
  on programmatic_pages(template_id, slug);

create index if not exists idx_programmatic_pages_tenant
  on programmatic_pages(tenant_slug, updated_at desc);

alter table programmatic_templates enable row level security;
alter table programmatic_pages enable row level security;

drop policy if exists "members access programmatic_templates" on programmatic_templates;
create policy "members access programmatic_templates" on programmatic_templates
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

drop policy if exists "members access programmatic_pages" on programmatic_pages;
create policy "members access programmatic_pages" on programmatic_pages
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_programmatic_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists programmatic_templates_set_updated_at on programmatic_templates;
create trigger programmatic_templates_set_updated_at
  before update on programmatic_templates
  for each row execute function public.touch_programmatic_updated_at();

drop trigger if exists programmatic_pages_set_updated_at on programmatic_pages;
create trigger programmatic_pages_set_updated_at
  before update on programmatic_pages
  for each row execute function public.touch_programmatic_updated_at();
