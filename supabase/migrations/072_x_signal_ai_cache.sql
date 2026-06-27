-- 072: Cache AI engagement suggestions on x_signal_cards
-- Avoids re-calling gpt-4o-mini when the user views the same card again.
-- Also adds a x_post_ideas_cache table for tenant-level idea caching.

ALTER TABLE x_signal_cards
  ADD COLUMN IF NOT EXISTS ai_reply        text,
  ADD COLUMN IF NOT EXISTS ai_quote_tweet  text,
  ADD COLUMN IF NOT EXISTS ai_action       text CHECK (ai_action IN ('reply', 'quote', 'both', 'skip')),
  ADD COLUMN IF NOT EXISTS ai_score        integer,
  ADD COLUMN IF NOT EXISTS ai_reasoning    text,
  ADD COLUMN IF NOT EXISTS ai_generated_at timestamptz;

-- Per-tenant post ideas cache: one row per tenant, overwritten on refresh.
CREATE TABLE IF NOT EXISTS x_post_ideas_cache (
  tenant_slug   text        NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
  ideas         jsonb       NOT NULL DEFAULT '[]',
  signal_ids    text[]      NOT NULL DEFAULT '{}',
  generated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_slug)
);

ALTER TABLE x_post_ideas_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can read own post ideas cache"
  ON x_post_ideas_cache FOR SELECT
  USING (is_tenant_member(tenant_slug));

-- Service role (cron/actions) writes via admin client, bypasses RLS.
