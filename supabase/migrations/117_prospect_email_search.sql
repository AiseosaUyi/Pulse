-- 117: remember when Autopilot last looked for a lead's email, so it doesn't
-- search the same lead every day. Additive only; safe to re-run.

alter table public.prospects
  add column if not exists email_searched_at timestamptz,
  add column if not exists email_search_note text;

create index if not exists idx_prospects_email_search
  on public.prospects (tenant_slug, email_searched_at)
  where email_status is null;
