-- Server-side conversion tracking config. CAPI/Events API access tokens
-- are conventionally generated directly in each platform's own Events
-- Manager UI (Meta) or Ads Manager (TikTok pixel_code) — not derived from
-- the ads-management OAuth connection — so these are a distinct, manually
-- entered credential per Meta ad account. TikTok's Events API reuses the
-- Marketing API access token already stored on tiktok_ads_connections, so
-- it only needs a pixel_code here, no separate token.
alter table ad_accounts
  add column if not exists meta_pixel_id text,
  add column if not exists meta_capi_token_enc text,
  add column if not exists tiktok_pixel_code text;
