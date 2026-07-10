-- Part 3 of the /api/v1 + MCP build spec: notifications + mobile approvals.
-- One row per link sent (email or WhatsApp) asking a founder/manager to
-- approve, edit, or reject a piece of AI-drafted content — a scheduled_posts
-- row (source of "auto-publish-on-approve") or a content_briefs row.
--
-- No `expired` status value: expiry is computed at read time from
-- `token_expires_at < now()` while the row stays `pending` — avoids a cron
-- sweep dependency for correctness (a stale row is still safely inert; the
-- JWT itself also carries a matching `exp` claim, so a stale link 401s
-- before this table is even queried in the common case).
--
-- `status` is the one-time-use gate: approving/rejecting flips it away from
-- `pending`, so a replayed link naturally lands on the "already actioned"
-- read path instead of a second ledger table.

create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  target_type text not null check (target_type in ('scheduled_post', 'content_brief')),
  target_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  decided_at timestamptz,
  delivered_via text not null check (delivered_via in ('email', 'whatsapp')),
  delivered_to text not null,
  token_expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_approval_requests_tenant_status
  on approval_requests(tenant_slug, status);
create index if not exists idx_approval_requests_target
  on approval_requests(target_type, target_id);

alter table approval_requests enable row level security;

-- Human-driven reads (e.g. a future in-app "pending approvals" list) go
-- through RLS; the approve/reject/get-by-token API routes are JWT-authed
-- (no session, no auth.uid()) and always use the admin client, same
-- reasoning as every other admin-driven table in this codebase.
drop policy if exists "members access approval_requests" on approval_requests;
create policy "members access approval_requests"
  on approval_requests for all
  using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));
