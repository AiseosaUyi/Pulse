// SocialAPI.ai unified social publishing client.
// Docs: https://docs.social-api.ai
// One API key covers LinkedIn, Instagram, TikTok, YouTube (managed OAuth — no reviews needed).
// X/Twitter requires BYOK — excluded from this integration.

const BASE = "https://api.social-api.ai/v1";

export type SocialPlatform = "instagram" | "linkedin" | "tiktok" | "youtube" | "facebook" | "threads";

export interface SocialAccount {
  id: string;
  name: string;
  username: string;
  platform: string;
  status: string;
  brand_id: string;
  profile_picture_url?: string;
}

export interface PublishResult {
  id: string;
  status: string;
  targets: Array<{ account_id: string; status: string; post_id?: string; url?: string }>;
}

export function isSocialApiConfigured(): boolean {
  return !!process.env.SOCIAL_API_KEY;
}

function headers() {
  const key = process.env.SOCIAL_API_KEY;
  if (!key) throw new Error("SOCIAL_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/** List all connected accounts for this API key's workspace */
export async function listAccounts(): Promise<SocialAccount[]> {
  const res = await fetch(`${BASE}/accounts`, { headers: headers() });
  if (!res.ok) throw new Error(`SocialAPI listAccounts failed: ${await res.text()}`);
  const json = (await res.json()) as { data: SocialAccount[] };
  return json.data ?? [];
}

export interface PublishParams {
  accountIds: string[];         // SocialAPI account IDs to post to
  text: string;
  scheduledAt?: string;         // ISO8601 — omit to post immediately
  mediaUrls?: string[];         // Public URLs of media to attach
}

/** Publish or schedule a post to one or more connected accounts */
export async function publishPost(params: PublishParams): Promise<PublishResult> {
  const body: Record<string, unknown> = {
    text: params.text,
    targets: params.accountIds.map((id) => ({ account_id: id })),
  };
  if (params.scheduledAt) body.scheduled_at = params.scheduledAt;
  if (params.mediaUrls?.length) body.media_urls = params.mediaUrls;

  const res = await fetch(`${BASE}/posts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`SocialAPI publish failed (${res.status}): ${text}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as PublishResult;
}

/** Get post status by SocialAPI post ID */
export async function getPostStatus(postId: string): Promise<PublishResult> {
  const res = await fetch(`${BASE}/posts/${postId}`, { headers: headers() });
  if (!res.ok) throw new Error(`SocialAPI getPost failed: ${await res.text()}`);
  return (await res.json()) as PublishResult;
}

export interface PostMetricsTarget {
  account_id: string;
  platform: string;
  platform_post_id: string;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  extra: Record<string, unknown>;
  permalink: string | null;
  published_at: string | null;
  metrics_synced_at: string | null;
}

export interface PostMetrics {
  post_id: string;
  targets: PostMetricsTarget[];
}

/** Fetch engagement metrics for a published post by SocialAPI post ID */
export async function getPostMetrics(postId: string): Promise<PostMetrics> {
  const res = await fetch(`${BASE}/posts/${postId}/metrics`, { headers: headers() });
  if (!res.ok) throw new Error(`SocialAPI getPostMetrics failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as PostMetrics;
}
