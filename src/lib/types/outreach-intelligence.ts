export const CONVERSATION_STAGES = [
  "initial_contact",
  "interested",
  "objecting",
  "follow_up_requested",
  "cold",
  "converted",
  "lost",
] as const;

export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

export const OBJECTION_CATEGORIES = [
  "existing_provider",
  "timing",
  "price",
  "no_response",
  "not_interested",
  "other",
] as const;

export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "dead"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ANALYSIS_TRIGGER_TYPES = [
  "inbound_message",
  "dm_sent",
  "manual",
  "backfill",
  "import",
] as const;

export type AnalysisTriggerType = (typeof ANALYSIS_TRIGGER_TYPES)[number];

export interface ConversationAnalysisRecord {
  id: string;
  tenantSlug: string;
  prospectId: string;
  triggerType: AnalysisTriggerType;
  triggerId: string | null;
  conversationStage: ConversationStage;
  intentSummary: string;
  recommendedFollowUpAt: string | null;
  recommendedFollowUpNote: string | null;
  recommendedWaitDays: number | null;
  objectionDetected: boolean;
  objectionCategory: ObjectionCategory | null;
  riskLevel: RiskLevel;
  gruveRelevant: boolean;
  sippoyRelevant: boolean;
  model: string | null;
  costUsd: number;
  createdAt: string;
}

export const OUTREACH_CAMPAIGN_STATUSES = [
  "active",
  "paused",
  "archived",
] as const;

export type OutreachCampaignStatus =
  (typeof OUTREACH_CAMPAIGN_STATUSES)[number];

export interface OutreachCampaignRecord {
  id: string;
  tenantSlug: string;
  name: string;
  description: string | null;
  business: string | null;
  status: OutreachCampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProspectCampaignRecord {
  prospectId: string;
  campaignId: string;
  addedAt: string;
}

export interface ProspectNoteRecord {
  id: string;
  tenantSlug: string;
  prospectId: string;
  body: string;
  createdBy: string | null;
  createdAt: string;
}

export const STAGE_LABELS: Record<ConversationStage, string> = {
  initial_contact: "Initial contact",
  interested: "Interested",
  objecting: "Objecting",
  follow_up_requested: "Follow-up requested",
  cold: "Gone cold",
  converted: "Converted",
  lost: "Lost",
};

export const STAGE_COLORS: Record<ConversationStage, string> = {
  initial_contact: "bg-sidebar text-text-muted",
  interested: "bg-status-green/10 text-status-green",
  objecting: "bg-status-yellow/10 text-status-yellow",
  follow_up_requested: "bg-primary-500/10 text-primary-500",
  cold: "bg-sidebar text-text-muted",
  converted: "bg-status-green/20 text-status-green",
  lost: "bg-status-red/10 text-status-red",
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "text-status-green",
  medium: "text-status-yellow",
  high: "text-status-red",
  dead: "text-text-muted",
};

export const OBJECTION_LABELS: Record<ObjectionCategory, string> = {
  existing_provider: "Has existing provider",
  timing: "Bad timing",
  price: "Price concern",
  no_response: "No response",
  not_interested: "Not interested",
  other: "Other",
};

/** A unified timeline event for the prospect thread view. */
export type ThreadEventType =
  | "outbound_dm"
  | "inbound_message"
  | "note"
  | "status_change"
  | "analysis";

export interface ThreadEvent {
  id: string;
  type: ThreadEventType;
  createdAt: string;
  /** Outbound DM */
  dmBody?: string;
  dmStatus?: string;
  dmVersion?: number;
  /** Inbound message */
  messageBody?: string;
  /** Note */
  noteBody?: string;
  /** Status change */
  fromStatus?: string;
  toStatus?: string;
  /** AI analysis card */
  analysis?: ConversationAnalysisRecord;
}
