export interface CompetitorMove {
  intel_card_id: string;
  competitor_name: string;
  platform: string;
  content_type: string;
  why_notable: string;
  multiplier: number | null;
}

export interface WinningFormat {
  format: string;              // e.g. "TikTok reveal reel"
  platform: string;
  evidence: string;
  multiplier: number;
}

export interface RecommendedAction {
  priority: 1 | 2 | 3;
  action: string;
  target_module: "/intel-feed" | "/viral-trends" | "/content-briefs" | "/own-analytics" | "/seo-tracker" | "/leads" | "/ai-content" | null;
  rationale: string;
}

export interface OwnPerformance {
  posts_this_week: number;
  reach_this_week: number;
  reach_prior_week: number;
  pct_change: number | null;
  top_post: { title: string | null; reach: number } | null;
  worst_post: { title: string | null; reach: number } | null;
}

export interface SeoSummary {
  tracked_total: number;
  rising: number;
  declining: number;
  avg_position: number | null;
  avg_position_change: number | null;
  top10: number;
}

export interface LeadsSummary {
  total_active: number;
  new_warm: number;
  needs_followup: number;
  converted_this_week: number;
}

export interface WeeklyDigestRecord {
  id: string;
  tenantSlug: string;
  weekOf: string;
  strategicBrief: string | null;
  topCompetitorMoves: CompetitorMove[];
  winningFormats: WinningFormat[];
  recommendedActions: RecommendedAction[];
  ownPerformance: OwnPerformance | null;
  seoSummary: SeoSummary | null;
  leadsSummary: LeadsSummary | null;
  generatorModel: string | null;
  generatorCostUsd: number;
  generatedAt: string;
}

export interface DigestInputs {
  tenantSlug: string;
  tenantName: string;
  weekOf: string;
  topCompetitorMoves: CompetitorMove[];
  winningFormats: WinningFormat[];
  ownPerformance: OwnPerformance;
  seoSummary: SeoSummary;
  leadsSummary: LeadsSummary;
}
