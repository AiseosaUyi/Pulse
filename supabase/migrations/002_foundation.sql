-- PULSE Foundation: auth + multi-tenant
-- Phase 2: tenants, profiles, memberships, invitations + RLS retrofit

-- ─── tenants ─────────────────────────────────────────────────
create table if not exists tenants (
  slug text primary key,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─── profiles ────────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Auto-create profile row on auth signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── memberships ─────────────────────────────────────────────
create table if not exists memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_slug text not null references tenants(slug) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_slug)
);

create index if not exists idx_memberships_tenant on memberships(tenant_slug);
create index if not exists idx_memberships_user on memberships(user_id);

-- ─── invitations ─────────────────────────────────────────────
create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tenant_slug text not null references tenants(slug) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  token text not null unique default encode(gen_random_bytes(24), 'base64'),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_invitations_email on invitations(lower(email)) where accepted_at is null;
create index if not exists idx_invitations_token on invitations(token) where accepted_at is null;

-- ─── membership helper (bypasses RLS on memberships) ────────
create or replace function public.is_tenant_member(p_slug text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and tenant_slug = p_slug
  );
$$;

create or replace function public.tenant_role(p_slug text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from memberships
  where user_id = auth.uid() and tenant_slug = p_slug
  limit 1;
$$;

-- ─── Enable RLS ──────────────────────────────────────────────
alter table tenants enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;

-- ─── tenants policies ────────────────────────────────────────
drop policy if exists "members read tenants" on tenants;
drop policy if exists "authenticated create tenants" on tenants;
drop policy if exists "owners update tenant" on tenants;

create policy "members read tenants" on tenants
  for select using (public.is_tenant_member(slug));

create policy "authenticated create tenants" on tenants
  for insert with check (auth.uid() is not null and created_by = auth.uid());

create policy "owners update tenant" on tenants
  for update using (public.tenant_role(slug) = 'owner');

-- ─── profiles policies ───────────────────────────────────────
drop policy if exists "read profiles" on profiles;
drop policy if exists "update own profile" on profiles;

create policy "read profiles" on profiles for select using (true);
create policy "update own profile" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ─── memberships policies ────────────────────────────────────
drop policy if exists "read own and tenant memberships" on memberships;
drop policy if exists "owners manage memberships" on memberships;

create policy "read own and tenant memberships" on memberships
  for select using (
    user_id = auth.uid() or public.is_tenant_member(tenant_slug)
  );

create policy "owners manage memberships" on memberships
  for all using (public.tenant_role(tenant_slug) = 'owner')
  with check (public.tenant_role(tenant_slug) = 'owner');

-- ─── invitations policies ────────────────────────────────────
drop policy if exists "admins manage invitations" on invitations;

create policy "admins manage invitations" on invitations
  for all using (public.tenant_role(tenant_slug) in ('owner', 'admin'))
  with check (public.tenant_role(tenant_slug) in ('owner', 'admin'));

-- ─── Accept invitation RPC ───────────────────────────────────
create or replace function public.accept_invitation(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv invitations%rowtype;
  v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_user_email from auth.users where id = auth.uid();

  select * into v_inv from invitations
  where token = p_token
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if v_inv.id is null then
    raise exception 'Invalid or expired invitation';
  end if;

  if lower(v_inv.email) <> lower(v_user_email) then
    raise exception 'Invitation email does not match signed-in user';
  end if;

  insert into memberships (user_id, tenant_slug, role)
  values (auth.uid(), v_inv.tenant_slug, v_inv.role)
  on conflict (user_id, tenant_slug) do nothing;

  update invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_inv.id;

  return v_inv.tenant_slug;
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;

-- ─── Retrofit existing intel-feed tables ─────────────────────
-- User confirmed no data to preserve. Clear and re-scope under tenants + RLS.
delete from content_briefs;
delete from intel_cards;
delete from competitors;

alter table competitors
  drop constraint if exists competitors_tenant_fk,
  add constraint competitors_tenant_fk foreign key (tenant_id) references tenants(slug) on delete cascade;

alter table intel_cards
  drop constraint if exists intel_cards_tenant_fk,
  add constraint intel_cards_tenant_fk foreign key (tenant_id) references tenants(slug) on delete cascade;

alter table content_briefs
  drop constraint if exists content_briefs_tenant_fk,
  add constraint content_briefs_tenant_fk foreign key (tenant_id) references tenants(slug) on delete cascade;

-- Replace permissive policies with member-scoped ones
drop policy if exists "Allow all access to competitors" on competitors;
drop policy if exists "Allow all access to intel_cards" on intel_cards;
drop policy if exists "Allow all access to content_briefs" on content_briefs;
drop policy if exists "members access competitors" on competitors;
drop policy if exists "members access intel_cards" on intel_cards;
drop policy if exists "members access content_briefs" on content_briefs;

create policy "members access competitors" on competitors
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy "members access intel_cards" on intel_cards
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy "members access content_briefs" on content_briefs
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
