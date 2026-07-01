-- 077: global outbound templates
-- Templates can now be "global" (available to all tenants as defaults)
-- or tenant-specific (private, overrides globals).
-- tenant_slug becomes nullable; is_global distinguishes the two cases.

-- 1. Make tenant_slug nullable (existing rows keep their slugs).
alter table outbound_templates
  alter column tenant_slug drop not null;

-- 2. Add is_global flag.
alter table outbound_templates
  add column if not exists is_global boolean not null default false;

-- 3. Enforce the invariant: exactly one of (tenant_slug, is_global) is set.
alter table outbound_templates
  add constraint chk_global_xor_tenant
    check (
      (is_global = true  and tenant_slug is null) or
      (is_global = false and tenant_slug is not null)
    );

-- 4. Update RLS: anyone can read globals; only members can read/write their own.
drop policy if exists "members access outbound_templates" on outbound_templates;

create policy "read outbound_templates" on outbound_templates
  for select using (
    is_global = true
    or public.is_tenant_member(tenant_slug)
  );

create policy "insert outbound_templates" on outbound_templates
  for insert with check (
    is_global = false
    and public.is_tenant_member(tenant_slug)
  );

create policy "update outbound_templates" on outbound_templates
  for update using (
    is_global = false
    and public.is_tenant_member(tenant_slug)
  ) with check (
    is_global = false
    and public.is_tenant_member(tenant_slug)
  );

create policy "delete outbound_templates" on outbound_templates
  for delete using (
    is_global = false
    and public.is_tenant_member(tenant_slug)
  );
