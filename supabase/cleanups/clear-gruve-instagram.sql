-- One-off: remove Instagram data accidentally imported into gruve tenant.
-- Run in Supabase SQL Editor. Safe to re-run (deletes nothing if already clean).

delete from own_post_metrics
where tenant_slug = 'gruve'
  and platform = 'instagram';

-- Also remove any AI report generated from that import
delete from analytics_ai_reports
where tenant_slug = 'gruve'
  and platform = 'instagram';
