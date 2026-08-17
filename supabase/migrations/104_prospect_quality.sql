-- Lead quality/temperature — a second, independent dimension on prospects
-- alongside pipeline `status`. `status` answers "where is this lead in the
-- outreach process"; `quality` answers "how good is this lead". Plain text
-- + check constraint, matching the existing `status` column shape (not a
-- Postgres enum type).
--
-- `duplicate_of_id` is a self-reference so a suspected duplicate can be
-- flagged/linked to the prospect it duplicates without ever deleting a row
-- (this API has no delete endpoint anywhere, by design).

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS quality TEXT NOT NULL DEFAULT 'unscored'
  CHECK (quality IN ('unscored', 'hot', 'warm', 'cold', 'dead'));

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES prospects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_tenant_quality
  ON prospects(tenant_slug, quality, updated_at DESC);

-- Partial index — only duplicate-flagged rows are ever queried by this column.
CREATE INDEX IF NOT EXISTS idx_prospects_duplicate_of
  ON prospects(duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;

-- Backfill from signal_data->>'stage', present only on the subset of
-- prospects imported from an earlier Instagram DM audit. Everything else
-- (including rows where the key is absent) defaults to 'unscored' already.
-- 'Customer' backfills to 'hot' — those prospects converted, so the
-- historical quality read on them was clearly correct. 'Lost' and
-- 'Not a lead' both backfill to 'dead'.
UPDATE prospects
SET quality = CASE lower(trim(signal_data->>'stage'))
  WHEN 'hot' THEN 'hot'
  WHEN 'warm' THEN 'warm'
  WHEN 'cold' THEN 'cold'
  WHEN 'customer' THEN 'hot'
  WHEN 'lost' THEN 'dead'
  WHEN 'not a lead' THEN 'dead'
  ELSE quality
END
WHERE signal_data ? 'stage';
