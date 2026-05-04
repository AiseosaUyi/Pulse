-- Slice — Content Engine. Format-driven video plan generation for
-- short-form social. Two-tier templates: platform-scope (read-only,
-- shared) + tenant-scope (forks, editable). Plans are produced
-- on-demand 3 at a time and ship with a ready-to-paste creative
-- prompt for Seedance / Kling / manual editing, plus predicted
-- virality / education / conversion scores.
--
-- See docs in the office-hours plan: this generalizes early so
-- carousel/thread/podcast variants can plug into the same UX
-- without a new schema.

create type content_medium as enum ('video');
create type content_format_scope as enum ('platform','tenant');

-- ── content_format_templates ────────────────────────────────
create table if not exists content_format_templates (
  id uuid primary key default gen_random_uuid(),
  scope content_format_scope not null,
  -- null when scope='platform'; FK on tenants(slug) when scope='tenant'
  tenant_slug text references tenants(slug) on delete cascade,
  -- set on a tenant fork — points back to the platform template the
  -- fork was created from. Allows the UI to show "customized from".
  parent_template_id uuid references content_format_templates(id)
    on delete set null,
  medium content_medium not null default 'video',
  name text not null,
  description text,
  category text,
  duration_min int not null check (duration_min > 0),
  duration_max int not null check (duration_max >= duration_min),
  -- Ordered list of structural beats: ['hook','body','payoff'].
  structure jsonb not null default '[]'::jsonb,
  tone text,
  default_scenes int not null default 1 check (default_scenes >= 1),
  example_hook text,
  example_script text,
  is_active boolean not null default true,
  -- Updated whenever a plan is generated using this template — the
  -- service-layer rotator weights against this for fair coverage.
  last_generated_at timestamptz,
  -- Scope/tenant invariant: platform rows never carry a tenant_slug.
  check (
    (scope = 'platform' and tenant_slug is null)
    or (scope = 'tenant' and tenant_slug is not null)
  ),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cft_platform_active
  on content_format_templates (medium, is_active)
  where scope = 'platform';

create index if not exists idx_cft_tenant_active
  on content_format_templates (tenant_slug, medium, is_active)
  where scope = 'tenant';

create index if not exists idx_cft_tenant_parent
  on content_format_templates (tenant_slug, parent_template_id);

alter table content_format_templates enable row level security;

-- Read: every authed user sees platform rows; tenant rows visible to
-- their members only.
drop policy if exists "read content_format_templates" on content_format_templates;
create policy "read content_format_templates" on content_format_templates
  for select
  using (scope = 'platform' or public.is_tenant_member(tenant_slug));

-- Insert: only into your own tenant scope, owner/admin only.
drop policy if exists "insert tenant content_format_templates" on content_format_templates;
create policy "insert tenant content_format_templates" on content_format_templates
  for insert
  with check (
    scope = 'tenant'
    and public.tenant_role(tenant_slug) in ('owner','admin')
  );

-- Update: tenant rows only, owner/admin only.
drop policy if exists "update tenant content_format_templates" on content_format_templates;
create policy "update tenant content_format_templates" on content_format_templates
  for update
  using (
    scope = 'tenant'
    and public.tenant_role(tenant_slug) in ('owner','admin')
  )
  with check (
    scope = 'tenant'
    and public.tenant_role(tenant_slug) in ('owner','admin')
  );

-- Delete: tenant rows only, owner/admin only.
drop policy if exists "delete tenant content_format_templates" on content_format_templates;
create policy "delete tenant content_format_templates" on content_format_templates
  for delete
  using (
    scope = 'tenant'
    and public.tenant_role(tenant_slug) in ('owner','admin')
  );

create or replace function public.touch_content_format_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists content_format_templates_set_updated_at
  on content_format_templates;
create trigger content_format_templates_set_updated_at
  before update on content_format_templates
  for each row execute function public.touch_content_format_templates_updated_at();


-- ── content_plans ───────────────────────────────────────────
create table if not exists content_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  template_id uuid references content_format_templates(id) on delete set null,
  -- Snapshot at generation time so the plan is stable even if the
  -- template is renamed/deleted later.
  template_name text not null,
  template_category text,
  medium content_medium not null default 'video',
  -- Free-form so we can add new platforms without a migration.
  platform text not null,
  -- Structured plan: hook, scenes[], tone, ready_prompt, etc.
  -- Schema validated by the AI generator (Zod) on insert.
  output jsonb not null,
  predicted_virality   int check (predicted_virality   between 0 and 10),
  predicted_education  int check (predicted_education  between 0 and 10),
  predicted_conversion int check (predicted_conversion between 0 and 10),
  -- 'seedance' | 'kling' | 'manual' | 'capcut' (free-form for future tools)
  suggested_tool text,
  suggested_tool_reason text,
  status text not null default 'draft'
    check (status in ('draft','approved','used','dismissed')),
  feedback text not null default 'none'
    check (feedback in ('none','good','bad')),
  feedback_notes text,
  generator_model text,
  generator_cost_usd numeric(8,4),
  -- Groups the 3-at-a-time generation; UI uses this for "this batch".
  batch_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_content_plans_tenant_recent
  on content_plans (tenant_slug, created_at desc);
create index if not exists idx_content_plans_tenant_batch
  on content_plans (tenant_slug, batch_id);

alter table content_plans enable row level security;

drop policy if exists "members access content_plans" on content_plans;
create policy "members access content_plans" on content_plans
  for all
  using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function public.touch_content_plans_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists content_plans_set_updated_at on content_plans;
create trigger content_plans_set_updated_at
  before update on content_plans
  for each row execute function public.touch_content_plans_updated_at();


-- ── Seed: 15 platform templates ─────────────────────────────
-- Covers Gruve (events) + Sippy (drinks/CPG) + a few generic
-- patterns. Tenants fork these via the UI; the originals stay
-- read-only so platform-level improvements propagate.

insert into content_format_templates
  (scope, medium, name, description, category,
   duration_min, duration_max, structure, tone, default_scenes,
   example_hook, example_script)
values
  ('platform','video','POV Pain',
    'Short relatable problem stated camera-to-face. Punchline reveals the brand as the relief.',
    'ugc', 6, 12,
    '["hook","punchline"]'::jsonb,
    'relatable, casual, slightly self-deprecating', 1,
    'me trying to find a ticket that is not 4x face value', null),
  ('platform','video','Street Interview',
    'Quick public-space interview asking strangers a question that surfaces the brand pain.',
    'ugc', 15, 30,
    '["question","reactions","payoff"]'::jsonb,
    'authentic, observational, kind', 3,
    'asking strangers what they would pay for the worst event experience they ever had', null),
  ('platform','video','Event Chaos vs Smooth',
    'Split-screen contrasting messy event entry/checkout against the brand''s smooth path.',
    'storytelling', 8, 15,
    '["chaos","cut","smooth","logo"]'::jsonb,
    'high-contrast, satisfying', 2,
    null, null),
  ('platform','video','Storytelling — Failure to Solution',
    'Short narrative: founder/customer hits a wall, finds the product, things change.',
    'storytelling', 20, 40,
    '["setup","failure","discovery","resolution"]'::jsonb,
    'sincere, grounded', 4,
    null, null),
  ('platform','video','Behind the Scenes',
    'Operator-side glimpse — event prep, kitchen, warehouse, founder''s desk.',
    'aesthetic', 10, 20,
    '["scene","beats","reveal"]'::jsonb,
    'documentary, intimate', 3,
    null, null),
  ('platform','video','Hot Takes',
    'Direct-to-camera opinion that contradicts category common-wisdom.',
    'ugc', 8, 15,
    '["claim","reasoning","close"]'::jsonb,
    'confident, slightly contrarian', 1,
    null, null),
  ('platform','video','Fake UGC Review',
    'Looks like a satisfied customer review; tightly framed phone-quality shot.',
    'social_proof', 8, 15,
    '["product_in_hand","quick_take","cta"]'::jsonb,
    'casual, slightly underproduced', 1,
    null, null),
  ('platform','video','Product Motion Loop',
    'Bottle/can sliding, replacing, repeating in seamless loop.',
    'aesthetic', 4, 8,
    '["loop"]'::jsonb,
    'tactile, satisfying, hypnotic', 1,
    null, null),
  ('platform','video','Pour and Satisfaction',
    'Drink poured slow-mo into glass; reaction shot or close-up of bubbles.',
    'aesthetic', 5, 10,
    '["pour","reaction"]'::jsonb,
    'sensory, slow, ASMR', 2,
    null, null),
  ('platform','video','Fridge Restock',
    'Restocking the fridge with the product; satisfying organization montage.',
    'aesthetic', 8, 15,
    '["empty","restock","arranged"]'::jsonb,
    'satisfying, clean, organized', 3,
    null, null),
  ('platform','video','Party Prep',
    'Setting up a table or bar with the product as the centerpiece.',
    'aesthetic', 10, 20,
    '["arrival","setup","reveal"]'::jsonb,
    'aspirational, social', 3,
    null, null),
  ('platform','video','Delivery Experience',
    'Box arrives, opens to reveal product, first-use moment.',
    'social_proof', 10, 18,
    '["arrival","unbox","first_use"]'::jsonb,
    'genuine excitement', 3,
    null, null),
  ('platform','video','Cocktail Build',
    'Step-by-step recipe with product as the hero ingredient.',
    'product', 12, 20,
    '["ingredients","build","finish"]'::jsonb,
    'instructional, polished', 4,
    null, null),
  ('platform','video','Price Comparison',
    'Visual comparison of the brand''s price/value vs alternatives.',
    'social_proof', 8, 15,
    '["alt_price","brand_price","verdict"]'::jsonb,
    'matter-of-fact, confident', 2,
    null, null),
  ('platform','video','UGC Reaction',
    'First-time taste/use reaction filmed phone-style.',
    'social_proof', 8, 15,
    '["pickup","first_taste","reaction"]'::jsonb,
    'authentic, surprised', 1,
    null, null);
