-- Six frictions found in the agent write path (an agent sweeps Instagram
-- every 3 hours and writes what it finds into Pulse over MCP) — verified
-- against source, not speculative. This migration covers the schema half:
--
-- 1. engagement_items gets `why`/`body`, matching action_items — today
--    engagementRowToQueueRow hardcodes both to null even though the row
--    anatomy already renders `why` on compose rows once it's populated.
-- 4. engagement_items gets a nullable `prospect_id` FK — inbound_messages
--    already has this column; today the agent puts the id in `meta` where
--    nothing reads it, so the linked prospect never surfaces on the row.
-- 6. prospects gets a nullable `external_account_id`, preferred as the
--    upsert conflict target over (tenant_slug, platform, handle) when
--    present — Instagram handles change, and a handle-keyed upsert creates
--    a duplicate on the next sweep instead of updating the renamed account.
--    Full (non-partial) unique index, same reasoning as 057/090/106: NULLs
--    never conflict with each other, only rows that share a real value do.

alter table engagement_items
  add column if not exists why text,
  add column if not exists body text,
  add column if not exists prospect_id uuid references prospects(id) on delete set null;

create index if not exists idx_engagement_items_prospect
  on engagement_items(prospect_id) where prospect_id is not null;

alter table prospects
  add column if not exists external_account_id text;

create unique index if not exists uq_prospects_external_account
  on prospects(tenant_slug, platform, external_account_id);
