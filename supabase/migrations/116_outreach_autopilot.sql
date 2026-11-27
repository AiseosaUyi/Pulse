-- 116: Outreach autopilot.
--
-- Pulse now SENDS outreach email, but only what a human approved:
--   compose draft -> daily approval email to the owner -> approve/edit/skip
--   -> send from the workspace's own mailbox (Gruve from Gruve, Sippy from
--   contact@sippy.life) inside a send window and a daily cap -> follow-ups
--   drafted automatically, again for approval -> replies read from the same
--   mailbox stop the sequence.
--
-- Safety rules this schema backs:
--   * Only rows with send_via = 'mailbox' AND status = 'approved' are ever
--     sent. Older in-app "approved" DMs have send_via null and are never
--     picked up.
--   * The mailbox starts disabled. Nothing sends until an owner turns it on.
--   * 'sending' is a claim state so two cron runs can never send one row twice.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. outbound_dms: email fields, sequence fields, claim state
-- ─────────────────────────────────────────────────────────────────────────────
alter table outbound_dms
  add column if not exists subject text,
  add column if not exists to_email text,
  add column if not exists kind text not null default 'cold_open',
  add column if not exists parent_dm_id uuid references outbound_dms(id) on delete set null,
  add column if not exists message_id text,
  add column if not exists lint_warnings jsonb not null default '[]'::jsonb,
  add column if not exists send_via text,
  add column if not exists approved_via text,
  add column if not exists scheduled_send_at timestamptz,
  add column if not exists send_attempts int not null default 0,
  add column if not exists claimed_at timestamptz;

alter table outbound_dms drop constraint if exists outbound_dms_kind_check;
alter table outbound_dms add constraint outbound_dms_kind_check
  check (kind in ('cold_open', 'follow_up_1', 'follow_up_2', 'reply'));

alter table outbound_dms drop constraint if exists outbound_dms_send_via_check;
alter table outbound_dms add constraint outbound_dms_send_via_check
  check (send_via is null or send_via = 'mailbox');

alter table outbound_dms drop constraint if exists outbound_dms_status_check;
alter table outbound_dms add constraint outbound_dms_status_check
  check (status in ('drafted', 'approved', 'sending', 'sent', 'failed', 'replied', 'cancelled'));

create index if not exists idx_outbound_dms_send_queue
  on outbound_dms(tenant_slug, status, send_via, scheduled_send_at);
create index if not exists idx_outbound_dms_message_id
  on outbound_dms(tenant_slug, message_id) where message_id is not null;
create index if not exists idx_outbound_dms_sequence
  on outbound_dms(tenant_slug, kind, status, sent_at);

-- At most one follow-up of each kind per original email, so a cron retry
-- can never draft the same follow-up twice.
create unique index if not exists uq_outbound_dms_followup_per_parent
  on outbound_dms(parent_dm_id, kind) where parent_dm_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. outreach_mailboxes: one sending mailbox per workspace
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists outreach_mailboxes (
  tenant_slug text primary key references tenants(slug) on delete cascade,
  from_email text not null,
  from_name text not null,
  reply_to text,
  smtp_host text not null,
  smtp_port int not null default 587,
  smtp_user text not null,
  smtp_password_enc text not null,
  imap_host text,
  imap_port int not null default 993,
  enabled boolean not null default false,
  daily_cap int not null default 30 check (daily_cap between 1 and 200),
  send_window_start smallint not null default 9 check (send_window_start between 0 and 23),
  send_window_end smallint not null default 17 check (send_window_end between 1 and 24),
  send_weekdays smallint[] not null default '{1,2,3,4,5}',
  auto_follow_ups boolean not null default true,
  follow_up_1_days int not null default 3 check (follow_up_1_days between 1 and 30),
  follow_up_2_days int not null default 7 check (follow_up_2_days between 2 and 60),
  approver_email text not null,
  digest_hour smallint not null default 8 check (digest_hour between 0 and 23),
  auto_compose boolean not null default true,
  last_digest_at timestamptz,
  imap_uid_validity bigint,
  imap_last_uid bigint,
  imap_checked_at timestamptz,
  last_error text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (send_window_end > send_window_start),
  check (follow_up_2_days > follow_up_1_days)
);

-- Holds an encrypted mailbox password. No member policies: only the service
-- role reads or writes it, and the settings page never returns the password.
alter table outreach_mailboxes enable row level security;
drop policy if exists "support excluded from outreach_mailboxes" on outreach_mailboxes;
create policy "support excluded from outreach_mailboxes" on outreach_mailboxes
  as restrictive for all using (not public.is_support_member(tenant_slug));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. outreach_digests: one approval email = one signed link
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists outreach_digests (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  dm_ids uuid[] not null,
  sent_to text not null,
  token_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_outreach_digests_tenant on outreach_digests(tenant_slug, created_at desc);
alter table outreach_digests enable row level security;
-- Service role only (the review page is token-authed).

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. outreach_configs: editable follow-up copy
-- ─────────────────────────────────────────────────────────────────────────────
alter table outreach_configs
  add column if not exists follow_up_1_body text not null default
    E'{greeting}\n\nBringing this back to the top of your inbox. Would a short call this week be useful to see how this could work for {company}?\n\n{signature}',
  add column if not exists follow_up_2_body text not null default
    E'{greeting}\n\nLast note from me on this. If the timing is better later, a quick reply is all it takes and we can pick it up then.\n\n{signature}';
