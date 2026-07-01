-- Seed GLOBAL outbound templates (available to every tenant automatically).
-- Run once in the SQL Editor — no tenant slug needed.
-- Tokens filled at send-time: [FIRST_NAME], [COMPANY], [SIGNAL], [HANDLE], [EVENT]
-- To add tenant-specific overrides, insert rows with tenant_slug set and is_global = false.

insert into outbound_templates
  (tenant_slug, is_global, name, platform, template_type, body, angle, is_primary, status)
values

-- ── Cold open ────────────────────────────────────────────────────────────────
(null, true, 'Default – First reachout', 'any', 'cold_open',
E'Hey [FIRST_NAME]! 👋\n\n[SIGNAL] — love what you''re putting out.\n\nI''m with [COMPANY] and think there could be a great fit here. Would love to connect!',
'First touch — lead with their signal, soft ask', false, 'active'),

-- ── Follow-up 1 ──────────────────────────────────────────────────────────────
(null, true, 'Default – Follow-up 1', 'any', 'follow_up_1',
E'Hey [FIRST_NAME]! Following up on my last message 😊\n\nJust didn''t want it to get buried — I''m with [COMPANY] and would love to explore if there''s a fit.\n\nLet me know if you''re open to it!',
'3–5 days after cold open, no reply — short, no pressure', false, 'active'),

-- ── Follow-up 2 ──────────────────────────────────────────────────────────────
(null, true, 'Default – Follow-up 2', 'any', 'follow_up_2',
E'Hey [FIRST_NAME] — last one from me, promise 😄\n\nIf [COMPANY] isn''t the right fit right now, completely fine! We''re here whenever the timing is better — just DM us anytime 🙌',
'10–14 days — final attempt, warm close, leaves door open', false, 'active'),

-- ── Post-event ───────────────────────────────────────────────────────────────
(null, true, 'Default – Post-event', 'any', 'post_event',
E'Hey [FIRST_NAME]! [EVENT] looked amazing — must have been a lot to pull off! 🎉\n\nFor your next one, I''d love to chat about how [COMPANY] can be a part of it. What are you planning next?',
'Strike right after they ran an event — compliment + pivot', false, 'active'),

-- ── Event coming up ──────────────────────────────────────────────────────────
(null, true, 'Default – Event coming up', 'any', 'event_confirmed',
E'Hey [FIRST_NAME]! You mentioned [EVENT] coming up — wanted to check in!\n\n[COMPANY] would love to be involved. What does the timeline look like?\n\nShall we set up a quick call? 🙌',
'They mentioned an upcoming event — follow up on that specific thing', false, 'active'),

-- ── Promised reminder ────────────────────────────────────────────────────────
(null, true, 'Default – Promised reminder', 'any', 'promised_reminder',
E'Hey [FIRST_NAME]! You asked me to follow up — here I am 😄\n\nHoping now is a better time. [COMPANY] would love to connect whenever you''re ready! 🙌',
'They said remind me later — warm, references their ask', false, 'active'),

-- ── Re-engagement ────────────────────────────────────────────────────────────
(null, true, 'Default – Re-engagement', 'any', 're_engagement',
E'Hey [FIRST_NAME]! It''s been a while — hope things are going great! 🙌\n\nWe''ve been busy at [COMPANY] and I thought of you. Would love to reconnect — any exciting things in the pipeline for you?',
'Re-open weeks/months later with a warm check-in', false, 'active'),

-- ── Value add ────────────────────────────────────────────────────────────────
(null, true, 'Default – Value add', 'any', 'value_add',
E'Hey [FIRST_NAME]! Saw [SIGNAL] and thought of you 👋\n\nWe put together something that might be useful — happy to share it, no strings attached. Just good stuff from the [COMPANY] team 🙂',
'Lead with a resource or insight — no ask, pure goodwill', false, 'active'),

-- ── Objection response ───────────────────────────────────────────────────────
(null, true, 'Default – Objection response', 'any', 'objection_response',
E'Hey [FIRST_NAME]! Totally understand — timing and budget are everything.\n\nJust wanted to make sure you had the full picture on what [COMPANY] offers. Even a small first step might work well.\n\nNo pressure at all — happy to answer any questions 🙂',
'They pushed back — remove the barrier, keep it low-commitment', false, 'active')

on conflict do nothing;
