-- 037: tighten profiles SELECT policy.
--
-- Previous policy `read profiles` had `using (true)` — any authenticated
-- user could enumerate every profile in the database (display_name,
-- username, avatar_url) across tenant boundaries. There's no UI surface
-- that needs cross-tenant profile discovery. Restrict to:
--   1. own profile (always readable)
--   2. profiles of users you share a tenant membership with
--
-- All current callers (.eq("id", userId)) of profile reads pass IDs that
-- come from same-tenant memberships or auth.uid(), so this tightening is
-- behavior-preserving.

create or replace function public.shares_tenant_with(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from memberships me
    join memberships them on me.tenant_slug = them.tenant_slug
    where me.user_id = auth.uid()
      and them.user_id = p_user_id
  );
$$;

drop policy if exists "read profiles" on profiles;

create policy "read profiles" on profiles
  for select using (
    id = auth.uid()
    or public.shares_tenant_with(id)
  );
