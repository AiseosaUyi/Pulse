// LinkedIn OAuth 2.0 + UGC Post API.
// Docs: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow

const LI_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LI_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LI_SCOPES = ["w_member_social", "r_basicprofile"].join(" ");

export function isLinkedInConfigured(): boolean {
  return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

function callbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/integrations/linkedin/callback`;
}

export function buildLinkedInAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri: callbackUrl(),
    scope: LI_SCOPES,
    state,
  });
  return `${LI_AUTH_URL}?${params}`;
}

export interface LinkedInTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function exchangeLinkedInCode(code: string): Promise<LinkedInTokens> {
  const res = await fetch(LI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(),
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${await res.text()}`);
  return res.json() as Promise<LinkedInTokens>;
}

export async function fetchLinkedInUser(accessToken: string): Promise<{ id: string; name: string }> {
  const res = await fetch("https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LinkedIn user fetch failed: ${await res.text()}`);
  const data = (await res.json()) as { id: string; localizedFirstName: string; localizedLastName: string };
  return { id: data.id, name: `${data.localizedFirstName} ${data.localizedLastName}`.trim() };
}

export async function publishLinkedInPost(
  accessToken: string,
  authorUrn: string,
  content: string
): Promise<{ postId: string; postUrl: string }> {
  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:person:${authorUrn}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`LinkedIn publish failed (${res.status}): ${text}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  const postId = res.headers.get("x-restli-id") ?? "unknown";
  return { postId, postUrl: `https://www.linkedin.com/feed/update/${postId}/` };
}
