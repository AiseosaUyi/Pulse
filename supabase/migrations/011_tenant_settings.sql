-- Tenant settings (domain, currency, audience config, platform connections).
-- Stored as a jsonb blob on the tenants row so schema changes to the blob
-- don't require migrations. Real platform stats (followers/engagementRate)
-- will move to a dedicated table once API integrations land.

alter table tenants
  add column if not exists settings jsonb not null default '{}'::jsonb;
