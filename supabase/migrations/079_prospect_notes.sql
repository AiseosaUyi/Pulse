-- Outreach Intelligence — Phase 1
-- Structured notes per prospect, replacing the flat prospects.notes text
-- field for new entries. Old notes remain readable in the notes column;
-- new notes are written here so the thread timeline can include them
-- chronologically alongside outbound DMs and inbound messages.

create table if not exists prospect_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  body text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_prospect_notes_prospect
  on prospect_notes(prospect_id, created_at desc);

alter table prospect_notes enable row level security;

drop policy if exists "members access prospect_notes" on prospect_notes;
create policy "members access prospect_notes" on prospect_notes
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
