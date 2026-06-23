-- Platform connections: one row per tenant × platform.
-- Tokens stored encrypted at rest (AES-GCM via PLATFORM_TOKEN_KEY env var).
-- Only service-role (admin client) writes; tenant members can read their own rows.

create table if not exists platform_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  platform text not null check (platform in ('x', 'linkedin', 'instagram', 'tiktok', 'youtube')),
  platform_user_id text not null,
  platform_handle text,
  -- AES-GCM ciphertext: iv(12B) + tag(16B) + ciphertext, base64url encoded
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, platform)
);

create index if not exists idx_platform_connections_tenant
  on platform_connections(tenant_slug);

alter table platform_connections enable row level security;

create policy "members read platform_connections"
  on platform_connections for select
  using (public.is_tenant_member(tenant_slug));
-- INSERT / UPDATE / DELETE: service-role only (no authenticated policy)
