-- 119: reply drafts for WhatsApp and Instagram, sent by hand from a phone.
--
-- Pulse never sends a WhatsApp or Instagram message itself. A chat draft is
-- approved like an email, then a person taps "Send on WhatsApp" (or copies it
-- into Instagram) on their own phone and Pulse records that they did.
--
--   channel     'email' (default, every existing row) | 'whatsapp' | 'instagram'
--   to_contact  where a chat draft goes: E.164 phone (whatsapp) or handle (instagram)
--   send_via    null | 'mailbox' (the automatic sender) | 'by_hand' (a person, from their phone)
--
-- Invariant enforced here, not only in code: the automatic sender only ever
-- picks send_via = 'mailbox', and only an email row may carry it.
-- Safe to re-run.

alter table outbound_dms
  add column if not exists channel text not null default 'email',
  add column if not exists to_contact text;

alter table outbound_dms drop constraint if exists outbound_dms_channel_check;
alter table outbound_dms add constraint outbound_dms_channel_check
  check (channel in ('email', 'whatsapp', 'instagram'));

alter table outbound_dms drop constraint if exists outbound_dms_send_via_check;
alter table outbound_dms add constraint outbound_dms_send_via_check
  check (send_via is null or send_via in ('mailbox', 'by_hand'));

-- Mailbox sending is email-only; hand sending is chat-only.
alter table outbound_dms drop constraint if exists outbound_dms_send_via_channel_check;
alter table outbound_dms add constraint outbound_dms_send_via_channel_check
  check (
    send_via is null
    or (send_via = 'mailbox' and channel = 'email')
    or (send_via = 'by_hand' and channel <> 'email')
  );

-- At most one open chat reply per lead per channel: a new message rewrites
-- the open draft instead of stacking a second one.
create unique index if not exists uq_outbound_dms_open_chat_reply
  on outbound_dms (prospect_id, channel)
  where kind = 'reply' and channel <> 'email' and status in ('drafted', 'approved');

-- Uploading the same chat twice is deduplicated by the existing
-- uq_inbound_messages_external (tenant_slug, platform, external_id) from 102.

-- Extend the 116 guard: an end-user session (not the service role) may not
-- change a draft's channel or chat destination either, so text approved for
-- one person can't be redirected to another or moved onto the mailbox.
create or replace function public.guard_outbound_dms_send_fields()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.send_via is not null or new.scheduled_send_at is not null or new.message_id is not null
       or new.channel <> 'email' or new.to_contact is not null then
      raise exception 'outbound_dms: send fields are server-only' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.send_via is distinct from old.send_via
     or new.to_email is distinct from old.to_email
     or new.to_contact is distinct from old.to_contact
     or new.channel is distinct from old.channel
     or new.scheduled_send_at is distinct from old.scheduled_send_at
     or new.message_id is distinct from old.message_id
     or new.claimed_at is distinct from old.claimed_at
     or new.kind is distinct from old.kind
     or new.parent_dm_id is distinct from old.parent_dm_id then
    raise exception 'outbound_dms: send fields are server-only' using errcode = '42501';
  end if;

  if old.send_via is not null and (
       new.status is distinct from old.status
       or new.body is distinct from old.body
       or new.subject is distinct from old.subject) then
    raise exception 'outbound_dms: use Autopilot to change a mailbox email' using errcode = '42501';
  end if;

  return new;
end;
$$;
