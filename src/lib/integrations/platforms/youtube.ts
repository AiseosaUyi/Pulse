// YouTube Data API v3 — OAuth 2.0 + Community Posts.
// Docs: https://developers.google.com/youtube/v3

const YT_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const YT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
].join(" ");

export function isYouTubeConfigured(): boolean {
  return !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
}

function callbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/integrations/youtube/callback`;
}

export function buildYouTubeAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.YOUTUBE_CLIENT_ID!,
    redirect_uri: callbackUrl(),
    scope: YT_SCOPES,
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${YT_AUTH_URL}?${params}`;
}

export interface YouTubeTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeYouTubeCode(code: string): Promise<YouTubeTokens> {
  const res = await fetch(YT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(),
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`YouTube token exchange failed: ${await res.text()}`);
  return res.json() as Promise<YouTubeTokens>;
}

export async function refreshYouTubeToken(refreshToken: string): Promise<YouTubeTokens> {
  const res = await fetch(YT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.YOUTUBE_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`YouTube refresh failed: ${await res.text()}`);
  return res.json() as Promise<YouTubeTokens>;
}

export async function fetchYouTubeUser(accessToken: string): Promise<{ id: string; title: string }> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`YouTube channel fetch failed: ${await res.text()}`);
  const data = (await res.json()) as { items?: Array<{ id: string; snippet: { title: string } }> };
  const channel = data.items?.[0];
  if (!channel) throw new Error("No YouTube channel found for this account");
  return { id: channel.id, title: channel.snippet.title };
}

export async function revokeYouTubeToken(accessToken: string): Promise<void> {
  await fetch(`${YT_REVOKE_URL}?token=${accessToken}`, { method: "POST" });
}

export async function publishYouTubeCommunityPost(
  accessToken: string,
  content: string
): Promise<{ postId: string; postUrl: string }> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/communityPosts?part=snippet",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: { type: "text", textOriginal: content },
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`YouTube publish failed (${res.status}): ${text}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  const json = (await res.json()) as { id: string };
  return { postId: json.id, postUrl: `https://www.youtube.com/post/${json.id}` };
}
