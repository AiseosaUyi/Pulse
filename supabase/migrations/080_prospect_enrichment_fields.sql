-- Add enrichment columns to prospects for better outreach personalisation
-- and follow-up tracking.
--
-- category      : type of business / event (e.g. "Food festival", "Concert")
-- location      : city / region (e.g. "Lagos", "Port Harcourt")
-- verified_name : real / verified account name separate from handle
-- event_title   : specific event name for personalised DMs
-- last_reachout_at : when outreach was last made; drives "going cold" logic

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS verified_name TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS event_title TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS last_reachout_at TIMESTAMPTZ;
