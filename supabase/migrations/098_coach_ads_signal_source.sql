-- AI Coach gains a new signal source: real ad-account alerts (creative
-- fatigue, disapprovals, CPA anomalies) and budget guardrail rule firings.
-- These are inserted deterministically (created_by_ai = false, no LLM
-- call) rather than through the usual generateCoachActions() synthesis
-- path — the ad platform already knows exactly what happened and why, so
-- an AI paraphrase would add cost and uncertainty without adding signal.
alter table coach_actions drop constraint if exists coach_actions_source_type_check;
alter table coach_actions add constraint coach_actions_source_type_check
  check (source_type in (
    'blog_score',
    'platform_score',
    'keyword_gap',
    'intel_signal',
    'weekly_digest',
    'competitor_move',
    'distribution_gap',
    'generic',
    'ads_signal'
  ));
