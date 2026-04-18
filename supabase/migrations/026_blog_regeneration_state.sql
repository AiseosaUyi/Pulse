-- Phase D.2: chunked regeneration so the iterate-to-90 loop can run
-- on Vercel Hobby (60s function cap). Instead of one server action
-- doing initial → score → refine × 3 → score × 3 in one call
-- (~100s, times out), the client polls `advanceRegeneration` once
-- per step. State persists here.
--
-- Shape (TypeScript-authoritative, see RegenerationState type):
--   {
--     phase: 'starting' | 'scored' | 'refine_done' | 'ok'
--          | 'below_threshold' | 'failed',
--     draft: GeneratedBlogPost,
--     score: ScoreBlogResult | null,
--     passes: GenerationPassMeta[],
--     total_cost_usd: number,
--     refine_count: number,
--     feedback: string,
--     force: boolean,
--     target_word_count: number,
--     started_at: string (ISO),
--     updated_at: string (ISO),
--     error: string | null
--   }
--
-- Null when no regeneration is in progress (idle).

alter table blog_posts
  add column if not exists regeneration_state jsonb;
