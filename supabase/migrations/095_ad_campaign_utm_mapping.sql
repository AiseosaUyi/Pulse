-- Blended-ROAS join key. Ad platforms don't share a common ID with
-- `orders.utm_campaign` — the join has to go through a UTM string, and
-- there's no reliable way to auto-derive that with full confidence (an
-- advertiser's ad destination URL isn't guaranteed to carry a UTM at all,
-- let alone one that matches the campaign name). So: default to a
-- slugified guess from the campaign name (low confidence, shown as such in
-- the UI), let the tenant override it once they've verified or set up
-- their own UTM convention, and store which case we're in.
alter table ad_campaigns
  add column if not exists utm_campaign_override text,
  add column if not exists utm_mapping_confirmed boolean not null default false;
