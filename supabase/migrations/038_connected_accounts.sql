-- Slice — Composio integration. Per-tenant social OAuth metadata for
-- Instagram, TikTok, LinkedIn. Composio holds the actual access tokens;
-- this table maps (tenant_slug → toolkit → alias) so server actions can
-- resolve which Composio alias to use when executing tools.
--
-- Aliases are short identity labels chosen at connection time (e.g.
-- 'gruve', 'sippy', 'personal'). One Composio org can hold multiple
-- aliases per toolkit thanks to the multi_account experimental flag.
--
-- Owner/admin RLS — same pattern as tenant_integrations (028). Members
-- shouldn't be able to connect/disconnect external auth on a tenant.

create table if not exists connected_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  toolkit text not null
    check (toolkit in ('instagram','tiktok','linkedin')),
  alias text not null,
  -- Composio's connection identifier (returned by the connection-request
  -- API). We use this for status checks and revocation.
  composio_connection_id text,
  -- Composio user_id this connection belongs to. Mirrors the value we
  -- pass when executing tools.
  composio_user_id text,
  -- Display fields populated after connection — fetched via toolkit
  -- profile tools (e.g. INSTAGRAM_GET_USER_INFO).
  user_handle text,
  display_name text,
  status text not null default 'pending'
    check (status in ('pending','active','expired','revoked')),
  connected_at timestamptz,
  last_synced_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, toolkit, alias)
);

create index if not exists idx_connected_accounts_tenant
  on connected_accounts(tenant_slug);
create index if not exists idx_connected_accounts_tenant_toolkit
  on connected_accounts(tenant_slug, toolkit);
create index if not exists idx_connected_accounts_active_sync
  on connected_accounts(toolkit, status, last_synced_at)
  where status = 'active';

alter table connected_accounts enable row level security;

drop policy if exists "owners manage connected_accounts" on connected_accounts;
create policy "owners manage connected_accounts" on connected_accounts
  for all
  using (
    public.tenant_role(tenant_slug) in ('owner','admin')
  )
  with check (
    public.tenant_role(tenant_slug) in ('owner','admin')
  );

create or replace function public.touch_connected_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists connected_accounts_set_updated_at on connected_accounts;
create trigger connected_accounts_set_updated_at
  before update on connected_accounts
  for each row execute function public.touch_connected_accounts_updated_at();
