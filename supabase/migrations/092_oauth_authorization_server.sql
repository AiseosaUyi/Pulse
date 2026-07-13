-- OAuth 2.1 authorization server for the remote MCP endpoint, so external
-- clients (Anthropic Cowork) can connect with "URL only" instead of a
-- static pulse_ext_ bearer token. Public clients only (Dynamic Client
-- Registration, no client secret), PKCE S256 mandatory. Access tokens are
-- self-contained signed JWTs (src/lib/oauth/tokens.ts) — NOT stored here;
-- only authorization codes and refresh tokens need DB rows, since both
-- must be revocable/one-time-use.
--
-- Unrelated to tenant_api_tokens (the existing pulse_ext_ static-token
-- system, untouched by this migration) and to approval_requests (mig 091,
-- a different signed-link flow) — separate trust boundary, separate
-- tables, same hash-before-store convention.

create table if not exists oauth_clients (
  id                        text primary key,
  client_name               text,
  redirect_uris             text[] not null,
  grant_types               text[] not null default '{authorization_code,refresh_token}',
  token_endpoint_auth_method text not null default 'none',
  created_at                timestamptz not null default now()
);

create table if not exists oauth_authorization_codes (
  id                    uuid primary key default gen_random_uuid(),
  code_hash             text not null unique,
  client_id             text not null references oauth_clients(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  tenant_slug           text not null references tenants(slug) on delete cascade,
  scopes                text not null,
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  expires_at            timestamptz not null,
  used_at               timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists idx_oauth_auth_codes_client on oauth_authorization_codes(client_id);
create index if not exists idx_oauth_auth_codes_user on oauth_authorization_codes(user_id);

create table if not exists oauth_refresh_tokens (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  client_id     text not null references oauth_clients(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  tenant_slug   text not null references tenants(slug) on delete cascade,
  scopes        text not null,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  rotated_from  uuid references oauth_refresh_tokens(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_oauth_refresh_tokens_client on oauth_refresh_tokens(client_id);
create index if not exists idx_oauth_refresh_tokens_user on oauth_refresh_tokens(user_id);

-- Service-role only (DCR, token exchange, and the /oauth/authorize page's
-- code-minting all run through the admin client) — no user-facing RLS
-- policy needed, same posture as other backend-only tables in this repo.
alter table oauth_clients enable row level security;
alter table oauth_authorization_codes enable row level security;
alter table oauth_refresh_tokens enable row level security;
