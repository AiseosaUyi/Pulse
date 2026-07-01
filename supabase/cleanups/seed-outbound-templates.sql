-- Seed pre-built outbound templates for all sequence stages.
-- Run once per tenant in the SQL Editor.
-- Replace 'your-tenant-slug' with the actual slug (e.g. 'sippy' or 'gruve').
-- Tokens: [FIRST_NAME], [HANDLE], [SIGNAL], [EVENT]

-- ─── Sippy (drinks delivery) ─────────────────────────────────────────────────

do $$
declare slug text := 'sippy'; begin  -- ← CHANGE THIS

insert into outbound_templates (tenant_slug, name, platform, template_type, body, angle, is_primary, status) values

(slug, 'Sippy – First reachout', 'instagram', 'cold_open',
E'Hey [FIRST_NAME]! 👋\n\nLove what you''re doing — [SIGNAL]. I run Sippy, we deliver premium drinks to events and homes across Lagos same-day.\n\nIf you ever need drinks sorted for a vibe or event, we''ve got you. No minimum, fast delivery.\n\nWould love to have you try us! 🥂',
'First touch — lead with their signal, keep it warm and short', true, 'active'),

(slug, 'Sippy – Follow-up 1', 'instagram', 'follow_up_1',
E'Hey [FIRST_NAME]! Following up on my last message 😊\n\nJust didn''t want it to get lost — we do same-day drinks delivery in Lagos, great for events and home vibes.\n\nLet me know if there''s anything coming up I can help with! 🥂',
'3-5 days after cold open, no reply — short, no pressure', true, 'active'),

(slug, 'Sippy – Follow-up 2', 'instagram', 'follow_up_2',
E'Hey [FIRST_NAME] — last one from me, promise 😄\n\nIf Sippy isn''t the right fit right now, completely fine! We''re here whenever you need drinks sorted — just DM us anytime 🙌',
'10-14 days — final attempt, leaves door open warmly', true, 'active'),

(slug, 'Sippy – Post-event', 'instagram', 'post_event',
E'Hey [FIRST_NAME]! Saw [EVENT] — looked amazing! 🎉\n\nFor your next one, we''d love to handle the drinks. Same-day delivery in Lagos, curated selections, we make it easy.\n\nAlready thinking about your next event?',
'Strike right after they ran an event — compliment + easy pivot', true, 'active'),

(slug, 'Sippy – Event coming up', 'instagram', 'event_confirmed',
E'Hey [FIRST_NAME]! You mentioned [EVENT] coming up — wanted to check in!\n\nWe can sort the drinks for it: same-day Lagos delivery, curated selections, no fuss. Just let us know the date and guest count 🥂\n\nShall I put something together for you?',
'They mentioned an upcoming event — follow up on that specific thing', true, 'active'),

(slug, 'Sippy – Promised reminder', 'instagram', 'promised_reminder',
E'Hey [FIRST_NAME]! You asked me to follow up — here I am 😄\n\nHoping now is a better time. We''re still delivering drinks across Lagos same-day — would love to sort something for you! 🥂',
'They said remind me later — warm, references their ask', true, 'active'),

(slug, 'Sippy – Re-engagement', 'instagram', 're_engagement',
E'Hey [FIRST_NAME]! It''s been a while — hope things are great!\n\nWe''ve expanded our range and are now covering more areas in Lagos with faster turnaround. Would love to have you try Sippy!\n\nWhat kind of events or occasions do you have coming up? 🎉',
'Re-open weeks later with something new as the hook', true, 'active'),

(slug, 'Sippy – Value add', 'instagram', 'value_add',
E'Hey [FIRST_NAME]! Saw [SIGNAL] and thought of you — we put together a quick drinks pairing guide for events that our customers love.\n\nHappy to send it over if you want! Genuinely useful, no catch 🙂',
'Give value before asking anything — builds trust', true, 'active'),

(slug, 'Sippy – Objection response', 'instagram', 'objection_response',
E'Hey [FIRST_NAME]! Totally understand — timing and budget are everything.\n\nOne thing that might help: we have a no-minimum option perfect for trying us out without commitment. Even a small order for your next gathering?\n\nNo pressure at all — just wanted to make sure you had the full picture 🙂',
'They pushed back on price or timing — remove the barrier', true, 'active')

on conflict do nothing;

end $$;

-- ─── Gruve (events) ───────────────────────────────────────────────────────────

do $$
declare slug text := 'gruve'; begin  -- ← CHANGE THIS

insert into outbound_templates (tenant_slug, name, platform, template_type, body, angle, is_primary, status) values

(slug, 'Gruve – First reachout', 'instagram', 'cold_open',
E'Hey [FIRST_NAME]! 👋\n\nLove your energy — [SIGNAL]. I''m with Gruve, we produce immersive events and experiences in Lagos.\n\nLooking at your audience I think there''s a great fit — any events coming up you''d want us involved in?',
'First touch — reference their signal, ask about events', true, 'active'),

(slug, 'Gruve – Follow-up 1', 'instagram', 'follow_up_1',
E'Hey [FIRST_NAME], circling back! 👋\n\nJust wanted to make sure my message didn''t get buried. We''re Gruve — Lagos event production — and I genuinely think we could do something interesting together.\n\nEven a quick chat to explore? 🙌',
'3-5 days after cold open — soft nudge', true, 'active'),

(slug, 'Gruve – Follow-up 2', 'instagram', 'follow_up_2',
E'Hey [FIRST_NAME] — won''t keep pinging! Just leaving the door open: if you ever want to collab on an event in Lagos, we''d love to be part of it.\n\nFeel free to reach back anytime. Good luck with everything 🎉',
'10-14 days — final message, warm close, no ask', true, 'active'),

(slug, 'Gruve – Post-event', 'instagram', 'post_event',
E'Hey [FIRST_NAME]! [EVENT] looked incredible — must have been a lot of work to pull off! 🎉\n\nFor your next one, we''d love to take the production side off your plate. What kind of experience are you planning next?',
'Right after their event — compliment then pivot to next one', true, 'active'),

(slug, 'Gruve – Event coming up', 'instagram', 'event_confirmed',
E'Hey [FIRST_NAME]! You mentioned [EVENT] coming up — excited to hear more!\n\nWe''d love to discuss how Gruve can help bring it to life — production, staging, concept. When''s the date?\n\nLet''s get on a quick call this week if you''re up for it 🙌',
'They confirmed an upcoming event — move fast', true, 'active'),

(slug, 'Gruve – Promised reminder', 'instagram', 'promised_reminder',
E'Hey [FIRST_NAME]! You asked me to follow up — hope now''s a better time!\n\nWe''re still here building out amazing events in Lagos. Would love to explore what we could do together 🎉',
'They asked to be reminded — reference that ask', true, 'active'),

(slug, 'Gruve – Re-engagement', 'instagram', 're_engagement',
E'Hey [FIRST_NAME]! Been a while — hope things are going well 🙌\n\nWe just wrapped [EVENT] and it was a blast — reminded me of your content and made me think it''d be great to finally connect. Any exciting events in your pipeline?',
'Re-open with a recent Gruve event as the hook', true, 'active'),

(slug, 'Gruve – Value add', 'instagram', 'value_add',
E'Hey [FIRST_NAME]! Saw [SIGNAL] — we recently put together an event planning checklist that a lot of creators and hosts have found super useful.\n\nHappy to send it your way — no strings attached! 🎉',
'Lead with a resource before pitching — builds goodwill', true, 'active'),

(slug, 'Gruve – Objection response', 'instagram', 'objection_response',
E'Hey [FIRST_NAME]! Completely understand — budget and timing are always a factor.\n\nOne option: we do consulting-only engagements where we help design the concept and you handle execution. Much lighter lift on cost.\n\nWorth a quick chat to see if that fits?',
'They pushed back on budget — offer a smaller entry point', true, 'active')

on conflict do nothing;

end $$;
