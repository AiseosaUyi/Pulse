-- Blog generation diagnostics. When generation runs multiple passes
-- (word-count expansion, or Phase B's score-based refinement), each
-- pass gets a row in `generation_meta.passes` so we can post-mortem
-- why a draft ended up short, off-brand, or low-scoring.
--
-- Shape:
--   {
--     passes: [
--       { pass: 1, kind: "generate"|"expand"|"refine",
--         word_count: 1180, score: 72, issues_fixed: [...],
--         cost_usd: 0.018, duration_ms: 8420 }
--     ],
--     target_word_count: 1200,
--     final_word_count: 1205,
--     final_score: 83,
--     stopped_reason: "ok"|"score_ceiling_hit"|"cost_cap"|"error",
--     total_cost_usd: 0.041
--   }
--
-- All Phase A really populates is { passes: [...], final_word_count,
-- stopped_reason: "ok" }. Phase B layers score + cost tracking on top.

alter table blog_posts
  add column if not exists generation_meta jsonb;

create index if not exists idx_blog_posts_tenant_generation_meta
  on blog_posts(tenant_slug)
  where generation_meta is not null;
