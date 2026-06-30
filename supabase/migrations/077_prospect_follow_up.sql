-- Outreach Intelligence — Phase 1
-- Adds follow-up scheduling to prospects. AI sets follow_up_at
-- automatically after conversation analysis. Employees can override it.
-- The daily command center reads this column to surface what's due.

alter table prospects
  add column if not exists follow_up_at timestamptz,
  add column if not exists follow_up_note text;

-- Partial index: only index prospects that have a follow-up scheduled
-- and aren't already closed. This is the exact set the command center
-- queries — fast even at 100k prospects per tenant.
create index if not exists idx_prospects_follow_up_active
  on prospects(tenant_slug, follow_up_at)
  where follow_up_at is not null
    and status not in ('closed_won', 'closed_lost', 'dismissed', 'unqualified');
