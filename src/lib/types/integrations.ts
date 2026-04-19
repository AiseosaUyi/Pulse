export const INTEGRATION_PROVIDERS = ["ga4"] as const;

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
};

export const PROVIDER_BLURBS: Record<IntegrationProvider, string> = {
  ga4:
    "Pull page + conversion data into Pulse so Coach can score what actually worked. Needs your GA4 property ID and a service-account JSON.",
};
