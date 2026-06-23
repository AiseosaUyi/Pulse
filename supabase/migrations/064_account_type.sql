-- Account type fork: a tenant is either a startup (the full marketing OS) or an
-- individual (the personal posting-cadence loop). Drives onboarding routing and
-- persona-curated navigation. Backfills every existing tenant to 'startup' so
-- nothing changes for current workspaces.

alter table tenants
  add column if not exists account_type text not null default 'startup'
    check (account_type in ('startup', 'individual'));
