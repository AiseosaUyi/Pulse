-- Reusable blog authors. Authoring previously re-typed author name/title/bio/
-- avatar/url on every post; this makes an author a saved, selectable entity
-- (with an AI-written authority bio) reused across posts. Tenant-scoped.

create table if not exists authors (
  id           uuid primary key default gen_random_uuid(),
  tenant_slug  text not null references tenants(slug) on delete cascade,
  name         text not null,
  title        text,          -- e.g. "Events Editor" (Person.jobTitle)
  bio          text,          -- E-E-A-T bio (Person.description)
  image_url    text,          -- avatar (public blog-assets URL)
  url          text,          -- author profile / social (Person.url)
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One author per name per tenant (selecting by name in the picker).
create unique index if not exists uq_authors_tenant_name
  on authors(tenant_slug, lower(name));

create index if not exists idx_authors_tenant
  on authors(tenant_slug, name);

alter table authors enable row level security;

drop policy if exists "members access authors" on authors;
create policy "members access authors" on authors
  for all using (public.is_tenant_member(tenant_slug))
  with check (public.is_tenant_member(tenant_slug));

create or replace function authors_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists authors_set_updated_at on authors;
create trigger authors_set_updated_at
  before update on authors
  for each row execute function authors_set_updated_at();
