-- Add gsc and contentful to the tenant_integrations provider check constraint
alter table tenant_integrations
  drop constraint if exists tenant_integrations_provider_check;

alter table tenant_integrations
  add constraint tenant_integrations_provider_check
  check (provider in ('ayrshare','wordpress','ghost','resend','ga4','gsc','contentful'));
