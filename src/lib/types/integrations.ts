export const INTEGRATION_PROVIDERS = ["ga4", "gsc", "contentful"] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export type IntegrationStatus = "connected" | "error" | "disconnected";

export interface IntegrationRecord {
  id: string;
  tenantSlug: string;
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  status: IntegrationStatus;
  hasSecret: boolean;
  lastError: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  ga4: "Google Analytics 4",
  gsc: "Google Search Console",
  contentful: "Contentful (publishing)",
};

export const PROVIDER_BLURBS: Record<IntegrationProvider, string> = {
  ga4:
    "Pull page + conversion data into Pulse so Coach can score what actually worked. Needs your GA4 property ID and a service-account JSON.",
  gsc:
    "Pull real Google rankings, impressions, clicks and average position per query. Auto-fills tracked-keyword positions and surfaces striking-distance opportunities. Needs your property URL and a service-account JSON.",
  contentful:
    "Where Pulse publishes approved blog posts + landing pages for this workspace. Needs your Contentful Space ID and a Content Management API token. Content-type ids + locale are optional overrides.",
};
