-- Engage candidates: posts (in the individual's topic space) surfaced as worth
-- engaging with. Populated by the discovery scrape (Apify); each can be turned
-- into a quote/reply draft, or dismissed. Tenant-scoped like everything else.

create table if not exists engage_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  platform text not null check (platform in ('x', 'linkedin')),
  author_handle text,
  content text not null,
  external_url text,
  source_query text,
  discovered_at timestamptz not null default now(),
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Dedupe by content per tenant so the same post isn't surfaced twice.
create unique index if not exists uniq_engage_candidate_content
  on engage_candidates(tenant_slug, md5(content));

create index if not exists idx_engage_candidates_feed
  on engage_candidates(tenant_slug, dismissed, discovered_at desc);

alter table engage_candidates enable row level security;

drop policy if exists "members access engage_candidates" on engage_candidates;
create policy "members access engage_candidates" on engage_candidates
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
