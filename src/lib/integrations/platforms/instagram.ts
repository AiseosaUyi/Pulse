// Instagram (Meta Graph API) OAuth + two-step container publish.
// Requires: Instagram Business or Creator account linked to a Facebook Page.
// Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing

const META_VERSION = "v19.0";
const META_AUTH_URL = `https://www.facebook.com/${META_VERSION}/dialog/oauth`;
const META_TOKEN_URL = `https://graph.facebook.com/${META_VERSION}/oauth/access_token`;
const IG_SCOPES = ["instagram_content_publish", "instagram_basic", "pages_show_list"].join(",");

export function isInstagramConfigured(): boolean {
  return !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
}

function callbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/integrations/instagram/callback`;
}

export function buildInstagramAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    redirect_uri: callbackUrl(),
    scope: IG_SCOPES,
    response_type: "code",
    state,
  });
  return `${META_AUTH_URL}?${params}`;
}

export interface InstagramTokens {
  access_token: string;
  token_type: string;
}

export async function exchangeInstagramCode(code: string): Promise<InstagramTokens> {
  const res = await fetch(META_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl(),
      code,
    }),
  });
  if (!res.ok) throw new Error(`Instagram token exchange failed: ${await res.text()}`);
  const shortLived = (await res.json()) as InstagramTokens;

  // Exchange short-lived token for a long-lived token (60 days)
  const longRes = await fetch(
    `https://graph.facebook.com/${META_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.INSTAGRAM_APP_ID}&client_secret=${process.env.INSTAGRAM_APP_SECRET}&fb_exchange_token=${shortLived.access_token}`
  );
  if (!longRes.ok) return shortLived; // fall back to short-lived
  return longRes.json() as Promise<InstagramTokens>;
}

export async function fetchInstagramUser(accessToken: string): Promise<{ igUserId: string; username: string }> {
  // Get FB pages the user manages
  const pagesRes = await fetch(
    `https://graph.facebook.com/${META_VERSION}/me/accounts?fields=instagram_business_account{username}&access_token=${accessToken}`
  );
  if (!pagesRes.ok) throw new Error(`Instagram pages fetch failed: ${await pagesRes.text()}`);
  const pagesData = (await pagesRes.json()) as {
    data: Array<{ instagram_business_account?: { id: string; username: string } }>;
  };
  const igAccount = pagesData.data
    .map((p) => p.instagram_business_account)
    .find(Boolean);
  if (!igAccount) throw new Error("No Instagram Business account linked to this Facebook profile");
  return { igUserId: igAccount.id, username: igAccount.username };
}

// Step 1: Create a media container. Returns creation_id to poll.
export async function createInstagramContainer(
  accessToken: string,
  igUserId: string,
  caption: string
): Promise<string> {
  const res = await fetch(
    `https://graph.facebook.com/${META_VERSION}/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption, media_type: "TEXT", access_token: accessToken }),
    }
  );
  if (!res.ok) throw new Error(`IG container create failed: ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  return json.id;
}

// Step 2: Poll container status. Returns 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED'
export async function pollInstagramContainer(
  accessToken: string,
  igUserId: string,
  creationId: string
): Promise<string> {
  const res = await fetch(
    `https://graph.facebook.com/${META_VERSION}/${igUserId}/media/${creationId}?fields=status_code&access_token=${accessToken}`
  );
  if (!res.ok) return "ERROR";
  const json = (await res.json()) as { status_code: string };
  return json.status_code ?? "IN_PROGRESS";
}

// Step 3: Publish a finished container.
export async function publishInstagramContainer(
  accessToken: string,
  igUserId: string,
  creationId: string
): Promise<{ postId: string; postUrl: string }> {
  const res = await fetch(
    `https://graph.facebook.com/${META_VERSION}/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`IG publish failed (${res.status}): ${text}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  const json = (await res.json()) as { id: string };
  return { postId: json.id, postUrl: `https://www.instagram.com/p/${json.id}/` };
}
