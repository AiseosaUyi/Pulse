-- Tighten RLS on intel-feed tables (migration 001 shipped `using (true)`).
-- Also adds FKs from tenant_id → tenants(slug) for referential integrity.
-- Column name `tenant_id` is kept as-is to avoid touching services/actions;
-- is_tenant_member() takes a text slug either way.

-- ─── Competitors ─────────────────────────────────────────────
drop policy if exists "Allow all access to competitors" on competitors;
drop policy if exists "members access competitors" on competitors;
create policy "members access competitors" on competitors
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

alter table competitors
  drop constraint if exists competitors_tenant_id_fkey;
alter table competitors
  add constraint competitors_tenant_id_fkey
  foreign key (tenant_id) references tenants(slug) on delete cascade;

-- ─── Intel Cards ─────────────────────────────────────────────
drop policy if exists "Allow all access to intel_cards" on intel_cards;
drop policy if exists "members access intel_cards" on intel_cards;
create policy "members access intel_cards" on intel_cards
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

alter table intel_cards
  drop constraint if exists intel_cards_tenant_id_fkey;
alter table intel_cards
  add constraint intel_cards_tenant_id_fkey
  foreign key (tenant_id) references tenants(slug) on delete cascade;

-- ─── Content Briefs ──────────────────────────────────────────
drop policy if exists "Allow all access to content_briefs" on content_briefs;
drop policy if exists "members access content_briefs" on content_briefs;
create policy "members access content_briefs" on content_briefs
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

alter table content_briefs
  drop constraint if exists content_briefs_tenant_id_fkey;
alter table content_briefs
  add constraint content_briefs_tenant_id_fkey
  foreign key (tenant_id) references tenants(slug) on delete cascade;
