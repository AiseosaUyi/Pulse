-- Extend prospect_searches.signal_type CHECK to include the new
-- ticketing_platform value used by the Apify-powered lead-gen cron.
alter table prospect_searches
  drop constraint if exists prospect_searches_signal_type_check;
alter table prospect_searches
  add constraint prospect_searches_signal_type_check
  check (signal_type in (
    'keyword','hashtag','event_host','event_attendee',
    'recent_post','manual','ticketing_platform'
  ));
