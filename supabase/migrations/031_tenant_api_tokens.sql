-- Slice 6b — Tenant API tokens. Lets the Chrome extension (and any
-- future first-party client) authenticate as a tenant without
-- inheriting the browser session. Each token maps to a tenant +
-- optional scope tag. Revoke by setting revoked_at.
--
-- Token storage: we hash on insert (sha256), keep only the prefix
-- and last 4 for UI display. The raw token is surfaced ONCE at
-- create time, never again.

create table if not exists tenant_api_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  /** Human label so owners know which client the token belongs to. */
  name text not null,
  token_hash text not null,
  token_prefix text not null,
  token_last4 text not null,
  /** Free-text scope tag. Today just 'extension'. Reserve for later. */
  scope text not null default 'extension'
    check (scope in ('extension','cli','automation','other')),
  created_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_tenant_api_tokens_hash
  on tenant_api_tokens(token_hash);

create index if not exists idx_tenant_api_tokens_tenant
  on tenant_api_tokens(tenant_slug, revoked_at);

alter table tenant_api_tokens enable row level security;

-- Owner/admin only — members should never see tokens.
drop policy if exists "owners manage tenant_api_tokens" on tenant_api_tokens;
create policy "owners manage tenant_api_tokens" on tenant_api_tokens
  for all
  using (public.tenant_role(tenant_slug) in ('owner','admin'))
  with check (public.tenant_role(tenant_slug) in ('owner','admin'));
