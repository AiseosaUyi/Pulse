export type CampaignPlatform =
  | "instagram"
  | "tiktok"
  | "twitter"
  | "linkedin"
  | "google"
  | "facebook"
  | "youtube";
export type CampaignStatus = "active" | "paused" | "completed" | "draft";

export interface Campaign {
  id: string;
  tenantSlug: string;
  name: string;
  platform: CampaignPlatform;
  status: CampaignStatus;
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  conversions: number;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  cpc: number;
  roas: number;
  costPerConversion: number;
}

export interface CampaignSummary {
  total: number;
  active: number;
  totalSpend: number;
  totalRevenue: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  overallRoas: number;
  avgCostPerConversion: number;
}

export const CAMPAIGN_PLATFORM_LABELS: Record<CampaignPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
  google: "Google",
  facebook: "Facebook",
  youtube: "YouTube",
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  draft: "Draft",
};
