-- Clean up FK duplication introduced by 009. Migration 002 already
-- created _tenant_fk constraints for these tables when it retrofitted
-- RLS; 009 added a second set named _tenant_id_fkey. Drop the dupes.

alter table competitors    drop constraint if exists competitors_tenant_id_fkey;
alter table intel_cards    drop constraint if exists intel_cards_tenant_id_fkey;
alter table content_briefs drop constraint if exists content_briefs_tenant_id_fkey;
