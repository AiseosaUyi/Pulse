-- Generalize the platform lead-gen cron from Gruve-only ticketing scraping to
-- a per-tenant "discovery sources" feature (any tenant can mine any set of
-- platforms — Gruve = ticketing sites, Sippy = drinks platforms, etc.).
-- Config lives in tenants.settings.discovery (JSONB, no schema change needed).
-- This migration only widens the signal_type CHECK to add the generic value.

alter table prospect_searches
  drop constraint if exists prospect_searches_signal_type_check;
alter table prospect_searches
  add constraint prospect_searches_signal_type_check
  check (signal_type in (
    'keyword','hashtag','event_host','event_attendee',
    'recent_post','manual','ticketing_platform','platform_discovery'
  ));
