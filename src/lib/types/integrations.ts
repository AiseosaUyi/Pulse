export const INTEGRATION_PROVIDERS = [
  "ayrshare",
  "wordpress",
  "ghost",
  "resend",
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export type IntegrationStatus = "connected" | "error" | "disconnected";

export interface AyrshareConfig {
  // Ayrshare profile key authorizes a single bundle of social
  // accounts (X, LinkedIn, FB, IG, TikTok, etc.). No extra config —
  // the API key is the credential.
  defaultPlatforms?: string[];
}

export interface WordpressConfig {
  site_url: string;
  username: string;
  // Category/tag slugs to auto-apply. Optional.
  default_status?: "draft" | "publish";
  default_categories?: string[];
}

export interface GhostConfig {
  admin_url: string;
  // Ghost admin keys look like `<key_id>:<secret>`. We split them
  // at persist time — id goes in secret_token, secret in secret_token_2.
  default_status?: "draft" | "published";
}

export interface ResendConfig {
  from_email: string;
  from_name?: string;
}

export type IntegrationConfig =
  | { provider: "ayrshare"; config: AyrshareConfig }
  | { provider: "wordpress"; config: WordpressConfig }
  | { provider: "ghost"; config: GhostConfig }
  | { provider: "resend"; config: ResendConfig };

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
  ayrshare: "Ayrshare (social networks)",
  wordpress: "WordPress",
  ghost: "Ghost",
  resend: "Resend (email)",
};

export const PROVIDER_BLURBS: Record<IntegrationProvider, string> = {
  ayrshare:
    "One API key covers X, LinkedIn, Instagram, TikTok, Facebook. Paste your Ayrshare profile key.",
  wordpress:
    "Publish blog posts straight to your WordPress site via the REST API. Needs site URL, username, and an application password.",
  ghost:
    "Publish blog posts to Ghost via the Admin API. Needs your admin API URL and Admin Key (id:secret).",
  resend:
    "Send newsletter blurbs + email blasts with Resend. Needs an API key and a verified sender email.",
};

export interface BlogPublicationRecord {
  id: string;
  tenantSlug: string;
  blogPostId: string;
  provider: "wordpress" | "ghost";
  externalId: string | null;
  externalUrl: string | null;
  status: "published" | "draft_pushed" | "failed";
  error: string | null;
  publishedAt: string;
}

export interface ScheduledPostPublicationRecord {
  id: string;
  tenantSlug: string;
  scheduledPostId: string;
  provider: "ayrshare";
  platform: string;
  externalId: string | null;
  externalUrl: string | null;
  status: "published" | "failed";
  error: string | null;
  publishedAt: string;
}
