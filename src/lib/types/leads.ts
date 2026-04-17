export type LeadStatus = "new" | "contacted" | "warm" | "cold" | "converted";
export type LeadType = "venue" | "sponsor" | "partner" | "influencer" | "media";
export type LeadValue = "low" | "medium" | "high" | "very_high";

export interface Lead {
  id: string;
  tenantSlug: string;
  name: string;
  company: string | null;
  type: LeadType;
  status: LeadStatus;
  value: LeadValue;
  lastContact: string | null;
  nextAction: string | null;
  notes: string | null;
  createdAt: string;
}

export interface LeadSummary {
  total: number;
  warm: number;
  cold: number;
  newCount: number;
}

export const LEAD_TYPE_LABELS: Record<LeadType, string> = {
  venue: "Venue",
  sponsor: "Sponsor",
  partner: "Partner",
  influencer: "Influencer",
  media: "Media",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  warm: "Warm",
  cold: "Cold",
  converted: "Converted",
};

export const LEAD_VALUE_LABELS: Record<LeadValue, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "Very High",
};
