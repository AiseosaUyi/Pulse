-- Sippy-specific outbound templates — override the generic global defaults
-- (seed-outbound-templates.sql) for the 'sippy' tenant only.
--
-- Why: the global defaults ("Hey [FIRST_NAME]! [SIGNAL] — love what you're
-- putting out. I'm with [COMPANY] and think there could be a great fit
-- here.") say nothing about what Sippy actually does or sells — a real
-- prospect reading it has no idea Sippy supplies drinks. These replace them
-- with Sippy's real trade-account value prop (bulk pricing, 14-day invoice
-- terms, one account across Sippy's own inventory + vetted marketplace
-- vendors — see fix-sippy-brand-positioning.sql for the source facts),
-- written like an actual salesperson (signed "Princess from Sippy", per
-- the founder) rather than a brand account, since conversion — not just
-- sending a message — is the point.
--
-- is_primary = true so selectTemplate() in prospect-thread-panel.tsx picks
-- these over the global default for the same template_type (both are
-- returned by RLS — is_primary desc is the tiebreaker). See migration 077
-- for the is_global / tenant_slug XOR invariant these rows satisfy.
--
-- Run once in the SQL Editor. Tokens filled at send-time: [FIRST_NAME],
-- [COMPANY], [SIGNAL], [HANDLE], [EVENT].

insert into outbound_templates
  (tenant_slug, is_global, name, platform, template_type, body, angle, is_primary, status)
values

-- ── Cold open ────────────────────────────────────────────────────────────────
('sippy', false, 'Sippy – First reachout', 'any', 'cold_open',
E'Hey [FIRST_NAME]! 👋\n\n[SIGNAL] — that caught my eye.\n\nI''m Princess from Sippy. We supply drinks — beer, spirits, wine, soft drinks and mixers — in bulk or retail, delivered straight to you. No middlemen, no chasing five different suppliers.\n\nWith a Sippy trade account you get:\n• Bulk pricing — better rates the more you order\n• 14-day invoice terms — order now, settle in two weeks\n• One account for our own stock + vetted vendors, all in one place\n\nWant me to put together a quote for your next order?',
'First touch — lead with their signal, then a concrete value prop (not a vague "great fit")', true, 'active'),

-- ── Follow-up 1 ──────────────────────────────────────────────────────────────
('sippy', false, 'Sippy – Follow-up 1', 'any', 'follow_up_1',
E'Hey [FIRST_NAME], following up 👋\n\nDidn''t want this to get buried — I''m Princess from Sippy. We stock bars, restaurants, hotels and event organizers with drinks in bulk, on 14-day invoice terms, so you''re not tying up cash on stock.\n\nWorth a quick chat about what you''re currently restocking with?',
'3–5 days after cold open, no reply — short, references the actual offer again', true, 'active'),

-- ── Follow-up 2 ──────────────────────────────────────────────────────────────
('sippy', false, 'Sippy – Follow-up 2', 'any', 'follow_up_2',
E'Hey [FIRST_NAME] — last one from me on this 😊\n\nIf now isn''t the right time, no worries at all. Whenever you''re ready to compare drink suppliers — bulk pricing, 14-day invoice terms, one account for everything — Princess from Sippy is a DM away.',
'10–14 days — final attempt, warm close, leaves door open', true, 'active'),

-- ── Post-event ───────────────────────────────────────────────────────────────
('sippy', false, 'Sippy – Post-event', 'any', 'post_event',
E'Hey [FIRST_NAME]! [EVENT] looked like a great turnout 🔥\n\nFor your next one — I''m Princess from Sippy, we supply drinks in bulk (beer, spirits, wine, soft drinks) with 14-day invoice terms, so stocking the bar doesn''t eat your cash flow upfront. What''s next on your calendar?',
'Strike right after they ran an event — compliment + concrete pivot to supply', true, 'active'),

-- ── Event coming up ──────────────────────────────────────────────────────────
('sippy', false, 'Sippy – Event coming up', 'any', 'event_confirmed',
E'Hey [FIRST_NAME]! Saw [EVENT] is coming up 👀\n\nI''m Princess from Sippy — we can handle the drinks supply for it. Bulk pricing, 14-day invoice terms, one order instead of five different runs.\n\nWant me to send over a quote based on your expected numbers?',
'They mentioned an upcoming event — pitch supplying it specifically', true, 'active'),

-- ── Promised reminder ────────────────────────────────────────────────────────
('sippy', false, 'Sippy – Promised reminder', 'any', 'promised_reminder',
E'Hey [FIRST_NAME]! You asked me to follow up — here I am 😊\n\nStill Princess from Sippy — happy to put a drinks quote together whenever the timing''s right for you. Just say the word.',
'They said remind me later — warm, references their ask, keeps the offer concrete', true, 'active'),

-- ── Re-engagement ────────────────────────────────────────────────────────────
('sippy', false, 'Sippy – Re-engagement', 'any', 're_engagement',
E'Hey [FIRST_NAME]! Been a minute 👋\n\nPrincess from Sippy here — still stocking bars, hotels, event organizers and stores with bulk drinks on 14-day invoice terms. Anything coming up on your side we could help supply?',
'Re-open weeks/months later with a warm check-in that restates the offer', true, 'active'),

-- ── Value add ────────────────────────────────────────────────────────────────
('sippy', false, 'Sippy – Value add', 'any', 'value_add',
E'Hey [FIRST_NAME]! Saw [SIGNAL] and thought of you 👋\n\nNo pitch this time — just flagging that Sippy trade accounts get bulk pricing that scales the more you order, so if you''re restocking regularly it''s worth comparing. Happy to send rates, no strings attached.',
'Lead with a genuine reason to reach out (pricing info), not a hard ask', true, 'active'),

-- ── Objection response ───────────────────────────────────────────────────────
('sippy', false, 'Sippy – Objection response', 'any', 'objection_response',
E'Hey [FIRST_NAME], totally get it — timing and cash flow matter 🙏\n\nThat''s actually the exact problem our 14-day invoice terms solve — you stock now, pay after you''ve sold. No pressure either way, just wanted you to have the full picture. Happy to answer anything.',
'They pushed back on timing/budget — the objection maps directly to a real Sippy feature', true, 'active')

on conflict do nothing;
