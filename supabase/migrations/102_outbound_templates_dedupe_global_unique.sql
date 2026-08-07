-- 102: dedupe duplicate global outbound templates + prevent recurrence
--
-- Root cause: supabase/cleanups/seed-outbound-templates.sql was run twice
-- against this environment. Its `on conflict do nothing` had no matching
-- unique constraint to target (the only prior unique index on this table
-- was `uq_outbound_templates_primary`, scoped to tenant_slug+platform,
-- which is null/irrelevant for global rows), so both runs inserted a
-- full set of 9 rows — 18 total, byte-identical pairs, for the 9 real
-- template_type values added in migration 076.
--
-- This migration is idempotent: safe to run against an already-clean
-- table (the DELETE removes 0 rows) as well as the duplicated one.

-- 1. One-time cleanup: keep the earliest row per template_type among
--    global templates (is_global = true), delete the rest.
delete from outbound_templates dupe
using outbound_templates keep
where dupe.is_global = true
  and keep.is_global = true
  and dupe.template_type = keep.template_type
  and (
    dupe.created_at > keep.created_at
    or (dupe.created_at = keep.created_at and dupe.id > keep.id)
  );

-- 2. Schema safeguard: at most one global template per template_type,
--    going forward. Partial index (mirrors the existing
--    uq_outbound_templates_primary pattern) since this table holds both
--    global (tenant_slug is null) and per-tenant rows.
create unique index if not exists uq_outbound_templates_global_type
  on outbound_templates(template_type)
  where is_global = true;
