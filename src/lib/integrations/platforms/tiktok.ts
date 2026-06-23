// TikTok Content Posting API (Content Publishing API v2).
// Docs: https://developers.tiktok.com/doc/content-posting-api-get-started

const TT_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TT_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TT_REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
const TT_SCOPES = ["video.publish", "video.upload", "user.info.basic"].join(",");

export function isTikTokConfigured(): boolean {
  return !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function callbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/integrations/tiktok/callback`;
}

export function buildTikTokAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    redirect_uri: callbackUrl(),
    scope: TT_SCOPES,
    response_type: "code",
    state,
  });
  return `${TT_AUTH_URL}?${params}`;
}

export interface TikTokTokens {
  access_token: string;
  refresh_token?: string;
  open_id: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeTikTokCode(code: string): Promise<TikTokTokens> {
  const res = await fetch(TT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl(),
    }),
  });
  if (!res.ok) throw new Error(`TikTok token exchange failed: ${await res.text()}`);
  const json = (await res.json()) as { data: TikTokTokens };
  return json.data;
}

export async function fetchTikTokUser(accessToken: string, openId: string): Promise<{ id: string; username: string }> {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=display_name,username",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`TikTok user fetch failed: ${await res.text()}`);
  const json = (await res.json()) as { data: { user: { display_name: string; username: string } } };
  return { id: openId, username: json.data.user.username ?? json.data.user.display_name };
}

export async function revokeTikTokToken(accessToken: string): Promise<void> {
  await fetch(TT_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      token: accessToken,
    }),
  });
}

// TikTok text-only caption post (via Content Publishing API "DIRECT_POST" flow)
// Note: text-only posts are not available in all markets. Video is the primary use case.
export async function publishTikTokCaption(
  accessToken: string,
  caption: string
): Promise<{ postId: string; postUrl: string }> {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 150),
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: { source: "PULL_FROM_URL" },
      post_mode: "DIRECT_POST",
      media_type: "TEXT",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`TikTok caption publish failed (${res.status}): ${text}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  const json = (await res.json()) as { data: { publish_id: string } };
  const postId = json.data.publish_id;
  return { postId, postUrl: `https://www.tiktok.com/` };
}
