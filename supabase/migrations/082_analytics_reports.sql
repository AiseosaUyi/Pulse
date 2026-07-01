-- Stores AI analyst reports generated after a data-export import session.
-- One row per (tenant, platform, generated_at); latest is shown in the UI.
CREATE TABLE IF NOT EXISTS analytics_ai_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_slug     TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
  platform        TEXT NOT NULL,                    -- instagram | twitter | tiktok | linkedin | all
  period_start    DATE,
  period_end      DATE,
  post_count      INTEGER NOT NULL DEFAULT 0,
  narrative       TEXT NOT NULL,                    -- paragraph summary
  recommendations JSONB NOT NULL DEFAULT '[]',      -- [{title, body}]
  raw_metrics     JSONB NOT NULL DEFAULT '{}',      -- aggregate numbers for UI cards
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_ai_reports_tenant_platform
  ON analytics_ai_reports (tenant_slug, platform, generated_at DESC);

ALTER TABLE analytics_ai_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can read analytics reports"
  ON analytics_ai_reports FOR SELECT
  USING (is_tenant_member(tenant_slug));

CREATE POLICY "tenant members can insert analytics reports"
  ON analytics_ai_reports FOR INSERT
  WITH CHECK (is_tenant_member(tenant_slug));
