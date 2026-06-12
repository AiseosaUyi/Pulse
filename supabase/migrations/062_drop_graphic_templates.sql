-- The brand-graphics studio feature was removed. Drop its (unused, empty)
-- table. migration 058 created it; we don't edit applied migrations, so this
-- additive migration removes it. cascade clears the RLS policy too.

drop table if exists graphic_templates cascade;
