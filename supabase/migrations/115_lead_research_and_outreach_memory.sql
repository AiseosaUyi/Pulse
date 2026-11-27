-- 115_lead_research_and_outreach_memory.sql
-- Lead Research & Outreach Memory Migration
--
-- 1. outreach_ledger: Exclude memory table unique on (workspace, key_type, key)
--    with no-downgrade guarantee (CONTACTED can never be downgraded to DROPPED).
-- 2. prospects additions: run_id, email evidence fields, segment, geography, evidence,
--    flags, website, company_name, channel handoff fields.
-- 3. engagement_items additions: channel handoff fields.
-- 4. engagement_item_messages: child table preserving message history per engagement item.
-- 5. outreach_configs: per-venture config storing segments, proofs, offers, asks,
--    banned/promise regexes, word limits, signature, and blocked countries.
-- 6. prospect_replies: log for replies, quoting text, channel, status, next step,
--    and tagged missing capability insights.
-- 7. agent_runs additions: run_id, search_budget, slice_label.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. OUTREACH LEDGER
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists outreach_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace text not null references tenants(slug) on delete cascade,
  tenant_slug text generated always as (workspace) stored,
  key_type text not null check (key_type in ('DOMAIN', 'EMAIL', 'HANDLE', 'PHONE')),
  key text not null,
  kind text not null check (kind in ('CONTACTED', 'DROPPED')),
  reason text,
  run_id text,
  company_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_outreach_ledger_workspace_key unique (workspace, key_type, key)
);

create index if not exists idx_outreach_ledger_lookup
  on outreach_ledger(workspace, key_type, key);

create index if not exists idx_outreach_ledger_run
  on outreach_ledger(workspace, run_id);

create index if not exists idx_outreach_ledger_kind
  on outreach_ledger(workspace, kind);

-- No-downgrade trigger: CONTACTED cannot be downgraded to DROPPED
create or replace function public.trg_outreach_ledger_no_downgrade()
returns trigger
language plpgsql
as $$
begin
  if old.kind = 'CONTACTED' and new.kind = 'DROPPED' then
    new.kind = 'CONTACTED';
    -- Preserve existing contacted reason if incoming has no reason or dropped reason
    if new.reason is null then
      new.reason = old.reason;
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_outreach_ledger_no_downgrade on outreach_ledger;
create trigger trg_outreach_ledger_no_downgrade
  before update on outreach_ledger
  for each row
  execute function public.trg_outreach_ledger_no_downgrade();

alter table outreach_ledger enable row level security;
drop policy if exists "members access outreach_ledger" on outreach_ledger;
drop policy if exists "members read outreach_ledger" on outreach_ledger;
-- Members read only. Every write goes through the service role (MCP / API),
-- so members cannot delete a CONTACTED row to dodge the no-downgrade trigger
-- or rewrite lint regexes. Support users are excluded, as in 103.
create policy "members read outreach_ledger" on outreach_ledger
  for select using (public.is_tenant_member(workspace));
drop policy if exists "support excluded from outreach_ledger" on outreach_ledger;
create policy "support excluded from outreach_ledger" on outreach_ledger
  as restrictive for all
  using (not public.is_support_member(workspace))
  with check (not public.is_support_member(workspace));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PROSPECTS ADDITIONS
-- ─────────────────────────────────────────────────────────────────────────────
alter table prospects
  add column if not exists run_id text,
  add column if not exists email text,
  add column if not exists email_source_url text,
  add column if not exists email_status text check (email_status in ('verified', 'unverified', 'dropped')),
  add column if not exists unverified_email text,
  add column if not exists evidence_url text,
  add column if not exists evidence text,
  add column if not exists evidence_date text,
  add column if not exists segment text,
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists team_size text,
  add column if not exists website text,
  add column if not exists company_name text,
  add column if not exists flags jsonb not null default '[]'::jsonb,
  add column if not exists channel_handoff text not null default 'none'
    check (channel_handoff in ('whatsapp', 'phone', 'email', 'none')),
  add column if not exists handoff_contact text,
  add column if not exists handoff_at timestamptz;

create index if not exists idx_prospects_tenant_run
  on prospects(tenant_slug, run_id);

create index if not exists idx_prospects_tenant_email
  on prospects(tenant_slug, email);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ENGAGEMENT_ITEMS ADDITIONS
-- ─────────────────────────────────────────────────────────────────────────────
alter table engagement_items
  add column if not exists channel_handoff text not null default 'none'
    check (channel_handoff in ('whatsapp', 'phone', 'email', 'none')),
  add column if not exists handoff_contact text,
  add column if not exists handoff_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ENGAGEMENT_ITEM_MESSAGES (Message History per Item)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists engagement_item_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  engagement_item_id uuid not null references engagement_items(id) on delete cascade,
  from_name text not null,
  from_handle text,
  content text not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_engagement_item_messages_thread
  on engagement_item_messages(tenant_slug, engagement_item_id, received_at desc);

alter table engagement_item_messages enable row level security;
drop policy if exists "members access engagement_item_messages" on engagement_item_messages;
create policy "members access engagement_item_messages" on engagement_item_messages
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. OUTREACH CONFIGS (Per-Venture Pitch, Segments & Lint Config)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists outreach_configs (
  workspace text primary key references tenants(slug) on delete cascade,
  tenant_slug text generated always as (workspace) stored,
  default_segment text not null,
  segments jsonb not null default '{}'::jsonb,
  banned_regex text not null,
  promise_regex text not null,
  bad_subject_regex text not null default '\b(idea for|quick idea|a thought on|quick question)\b',
  verdict_regex text not null default '\b(impressive|love|great|beautiful|stunning|awesome)\b',
  word_limits jsonb not null default '{"subject": [3, 7], "hook": [8, 22], "idea": [25, 45]}'::jsonb,
  signature text not null,
  blocked_countries text not null default 'belarus|iran|north korea|syria',
  idea_prefix text not null default 'What if there was',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table outreach_configs enable row level security;
drop policy if exists "members access outreach_configs" on outreach_configs;
drop policy if exists "members read outreach_configs" on outreach_configs;
-- Members read only. Every write goes through the service role (MCP / API),
-- so members cannot delete a CONTACTED row to dodge the no-downgrade trigger
-- or rewrite lint regexes. Support users are excluded, as in 103.
create policy "members read outreach_configs" on outreach_configs
  for select using (public.is_tenant_member(workspace));
drop policy if exists "support excluded from outreach_configs" on outreach_configs;
create policy "support excluded from outreach_configs" on outreach_configs
  as restrictive for all
  using (not public.is_support_member(workspace))
  with check (not public.is_support_member(workspace));

-- Seed Gruve and Sippy outreach configs
insert into outreach_configs (
  workspace,
  default_segment,
  segments,
  banned_regex,
  promise_regex,
  bad_subject_regex,
  verdict_regex,
  word_limits,
  signature,
  blocked_countries,
  idea_prefix
) values (
  'gruve',
  'organizers',
  '{
    "organizers": {
      "proof": [
        "We powered ticketing for major Lagos music concerts and food festivals with instant QR check-in and zero gate queues.",
        "Over 50,000 attendees checked into Nigerian events last quarter through Gruve door-scanning apps."
      ],
      "offer": [
        "Gruve gives event organisers transparent payout settlements directly to Nigerian bank accounts and real-time ticket analytics.",
        "We handle ticketing, registration and voter tallying in one portal with zero setup fees."
      ],
      "ask": [
        "Would a 2-minute walkthrough of our organiser dashboard be helpful for your upcoming events?",
        "Want me to send over our event check-in breakdown?"
      ]
    },
    "venues": {
      "proof": [
        "Top lounges and venues across VI and Lekki manage VIP tables and entry tickets directly through Gruve.",
        "Venues in Lagos use our fast smartphone scanners to eliminate counterfeit tickets."
      ],
      "offer": [
        "Turn weekend door entry into smooth digital check-in with fraud-proof QR validation.",
        "We provide dedicated venue portal access with live entry tracking and promoter split payouts."
      ],
      "ask": [
        "Could we share how other Lagos venues manage weekend guestlists on Gruve?",
        "Would you like to test our smartphone scanner at your next event?"
      ]
    },
    "pageants": {
      "proof": [
        "We verified over 100,000 paid votes for national beauty pageants and award ceremonies with fraud prevention.",
        "Gruve powered live audited voting across African pageant competitions with instant public leaderboards."
      ],
      "offer": [
        "Run paid voting with transparent transaction audit logs and instant contestant rankings.",
        "We support direct card and USSD payments across Nigeria so supporters vote without drop-off."
      ],
      "ask": [
        "Would seeing our live voting leaderboard for pageants help for your next edition?",
        "Want to see how our anti-fraud voting safeguards work?"
      ]
    }
  }'::jsonb,
  '\b(amazing|exciting|incredible|huge|revolutionary|game-?changer|leverage|synergy|cutting-edge|caught my eye|stood out|immersive|engaging|unlocks?|elevate|seamless|engagement|retention|showcase|impressive|testament|AI|budget|price|partnership)\b|[!;–—]| - ',
  '\b(I(''ll| will| can) (make|build|send|create|mock|put together)|for free|free (demo|sample|prototype|mock-?up)|demo|mock-?up|prototype|sample)\b',
  '\b(idea for|quick idea|a thought on|quick question)\b',
  '\b(impressive|love|great|beautiful|stunning|awesome)\b',
  '{"subject": [3, 7], "hook": [8, 22], "idea": [25, 45]}'::jsonb,
  'The Gruve Team',
  'belarus|iran|north korea|syria',
  'What if there was'
), (
  'sippy',
  'hospitality',
  '{
    "hospitality": {
      "proof": [
        "We supply weekly beverage and spirit restocks to over 40 lounges and cocktail bars across Lagos with guaranteed delivery windows.",
        "Top restaurants in Abuja trust Sippy for 100% verified authentic stock and direct distributor pricing."
      ],
      "offer": [
        "Sippy delivers wholesale pricing on premium spirits, mixers and wines with consolidated weekly invoicing.",
        "We guarantee genuine stock sourced direct from brand principals with temperature-controlled delivery across Lagos, Abuja and Calabar."
      ],
      "ask": [
        "Would our current wholesale price and stock catalog for venues be useful?",
        "Want me to send our bar and lounge beverage price sheet for this month?"
      ]
    },
    "caterers": {
      "proof": [
        "We supplied drinks logistics for 1,000+ guest wedding receptions and corporate galas with sale-or-return terms.",
        "Event planners across Lagos rely on us for chilled delivery and return of unopened cases."
      ],
      "offer": [
        "Get chilled event beverage delivery straight to your venue with flexible consignment return on unbroken cartons.",
        "We calculate precise case volumes for your guest count to eliminate overspending on drinks."
      ],
      "ask": [
        "Would a sample drinks planning breakdown for your upcoming event dates help?",
        "Could we send our caterer wholesale rates and consignment policy?"
      ]
    },
    "retailers": {
      "proof": [
        "We distribute direct-from-importer inventory to independent bottle shops and supermarkets across Lagos and Calabar.",
        "Independent retail partners benefit from consistent case availability during peak holiday restocks."
      ],
      "offer": [
        "Direct distributor pricing on fast-moving spirit and beer brands with reliable delivery schedules.",
        "Consolidated ordering across multiple beverage manufacturers on a single trade account."
      ],
      "ask": [
        "Can we send over our retail case catalog for this month?",
        "Would our volume discount tier sheet be of interest for your store?"
      ]
    }
  }'::jsonb,
  '\b(amazing|exciting|incredible|huge|revolutionary|game-?changer|leverage|synergy|cutting-edge|caught my eye|stood out|immersive|engaging|unlocks?|elevate|seamless|engagement|retention|showcase|impressive|testament|AI|budget|price)\b|[!;–—]| - ',
  '\b(I(''ll| will| can) (make|build|send|create|mock|put together)|for free|free (demo|sample|prototype|mock-?up)|demo|mock-?up|prototype|sample)\b',
  '\b(idea for|quick idea|a thought on|quick question)\b',
  '\b(impressive|love|great|beautiful|stunning|awesome)\b',
  '{"subject": [3, 7], "hook": [8, 22], "idea": [25, 45]}'::jsonb,
  'The Sippy Team',
  'belarus|iran|north korea|syria',
  'What if there was'
)
on conflict (workspace) do update set
  default_segment = excluded.default_segment,
  segments = excluded.segments,
  banned_regex = excluded.banned_regex,
  promise_regex = excluded.promise_regex,
  bad_subject_regex = excluded.bad_subject_regex,
  verdict_regex = excluded.verdict_regex,
  signature = excluded.signature,
  idea_prefix = excluded.idea_prefix,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PROSPECT REPLIES LOG & MISSING CAPABILITY INSIGHTS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists prospect_replies (
  id uuid primary key default gen_random_uuid(),
  workspace text not null references tenants(slug) on delete cascade,
  tenant_slug text generated always as (workspace) stored,
  prospect_id uuid references prospects(id) on delete set null,
  replied_at timestamptz not null default now(),
  channel text not null,
  quote text not null,
  status text not null check (status in ('interested', 'declined', 'dormant', 'closed')),
  next_step text,
  missing_capability text,
  created_at timestamptz not null default now()
);

create index if not exists idx_prospect_replies_tenant_date
  on prospect_replies(workspace, replied_at desc);

create index if not exists idx_prospect_replies_tenant_status
  on prospect_replies(workspace, status);

create index if not exists idx_prospect_replies_missing_capability
  on prospect_replies(workspace, missing_capability)
  where missing_capability is not null;

alter table prospect_replies enable row level security;
drop policy if exists "members access prospect_replies" on prospect_replies;
drop policy if exists "members read prospect_replies" on prospect_replies;
-- Members read only. Every write goes through the service role (MCP / API),
-- so members cannot delete a CONTACTED row to dodge the no-downgrade trigger
-- or rewrite lint regexes. Support users are excluded, as in 103.
create policy "members read prospect_replies" on prospect_replies
  for select using (public.is_tenant_member(workspace));
drop policy if exists "support excluded from prospect_replies" on prospect_replies;
create policy "support excluded from prospect_replies" on prospect_replies
  as restrictive for all
  using (not public.is_support_member(workspace))
  with check (not public.is_support_member(workspace));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. AGENT RUNS ADDITIONS
-- ─────────────────────────────────────────────────────────────────────────────
alter table agent_runs
  add column if not exists run_id text,
  add column if not exists search_budget int,
  add column if not exists slice_label text;
