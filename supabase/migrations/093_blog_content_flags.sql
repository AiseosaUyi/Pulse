-- Fabrication/voice-compliance guard for blog_posts (tenant-agnostic —
-- applies to every tenant's generated content, not just one). See
-- src/lib/blog/content-flags.ts for the scan itself.
--
-- content_flags: latest scan result — invented stats, time guarantees,
-- named testimonials, competitor prices, banned dash usage.
-- content_flags_cleared: a human explicitly reviewed the current flags
-- and approved publishing anyway. Reset to false on every content edit
-- so a stale clearance can't wave through a later, different edit.

alter table blog_posts
  add column if not exists content_flags jsonb not null default '[]'::jsonb,
  add column if not exists content_flags_cleared boolean not null default false;
