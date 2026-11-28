-- Sippy leads imported on 2026-08-24 and 2026-09-03 (the sales call sheet)
-- have their phone, email and category written inside signal_summary text,
-- e.g. "Feedback: will get back; Phone: +2348022821263; Category: lounge".
-- The real columns are empty, so the leads look like dummy data and the
-- WhatsApp chat matcher (by phone) can't find them.
--
-- This copies those values into their columns. It only fills columns that
-- are empty, changes nothing else, and deletes nothing. Emails go to
-- unverified_email (a hint only): Pulse never emails an address it has not
-- verified on the lead's own website.
--
-- Run step 1 first and look at it. Then run step 2.

-- 1. Preview (read-only)
select
  id,
  display_name,
  regexp_replace(substring(signal_summary from '(?i)Phone:?\s*(\+?\d[\d\s-]{7,16}\d)'), '[\s-]', '', 'g') as phone_found,
  lower(substring(signal_summary from '(?i)Email:?\s*([^\s;,]+@[^\s;,]+\.[a-z]{2,})')) as email_found,
  trim(substring(signal_summary from '(?i)Category:\s*([^;]+)')) as category_found
from prospects
where tenant_slug = 'sippy'
  and signal_summary is not null
order by created_at
limit 200;

-- 2. Apply
begin;

update prospects
set phone = regexp_replace(substring(signal_summary from '(?i)Phone:?\s*(\+?\d[\d\s-]{7,16}\d)'), '[\s-]', '', 'g')
where tenant_slug = 'sippy'
  and (phone is null or phone = '')
  and substring(signal_summary from '(?i)Phone:?\s*(\+?\d[\d\s-]{7,16}\d)') is not null;

update prospects
set unverified_email = lower(substring(signal_summary from '(?i)Email:?\s*([^\s;,]+@[^\s;,]+\.[a-z]{2,})')),
    email_status = coalesce(email_status, 'unverified')
where tenant_slug = 'sippy'
  and email is null
  and unverified_email is null
  and substring(signal_summary from '(?i)Email:?\s*([^\s;,]+@[^\s;,]+\.[a-z]{2,})') is not null;

update prospects
set category = left(trim(substring(signal_summary from '(?i)Category:\s*([^;]+)')), 80)
where tenant_slug = 'sippy'
  and (category is null or category = '')
  and substring(signal_summary from '(?i)Category:\s*([^;]+)') is not null;

-- Expect roughly: 346 phones, 108 emails, 647 categories (counted 2026-11-28).
select
  count(*) filter (where phone is not null) as with_phone,
  count(*) filter (where unverified_email is not null) as with_unverified_email,
  count(*) filter (where category is not null) as with_category
from prospects
where tenant_slug = 'sippy';

commit;
