export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string;
  currency: string;
  audienceConfig: AudienceConfig;
  platforms: PlatformConnection[];
  /** Blog category taxonomy for this workspace (drives the editor's Category
   *  picker). Empty = no fixed list (free-text). Multi-tenant: not hardcoded. */
  blogCategories: string[];
  createdAt: Date;
}

export interface AudienceConfig {
  primaryRegions: string[];
  expandedRegions: string[];
  targetDemographics: string[];
}

export interface PlatformConnection {
  platform: "instagram" | "tiktok" | "twitter" | "linkedin";
  connected: boolean;
  handle: string;
  followers: number;
  engagementRate: number;
  status: "active" | "needs_posts" | "low_activity" | "inactive";
}
