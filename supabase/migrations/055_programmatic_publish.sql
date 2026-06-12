-- Programmatic landing-page publish linkage (W5). When a programmatic_pages
-- row is pushed to Gruve's `seoLandingPage` Contentful type and published, we
-- record the Contentful entry id + the live URL so the UI can show "live" with
-- a link, and re-publish is idempotent (upsert by pulseId on the CMA side).
-- Additive + nullable — no backfill.

alter table programmatic_pages
  add column if not exists contentful_entry_id text,
  add column if not exists live_url text,
  add column if not exists published_at timestamptz;
