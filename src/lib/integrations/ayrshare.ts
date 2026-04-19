// Ayrshare wrapper. One profile key authorizes posting to every
// connected social network (X, LinkedIn, Instagram, TikTok, Facebook,
// YouTube Shorts, Pinterest, Reddit, Bluesky, Threads).
// Docs: https://www.ayrshare.com/docs
//
// Keep this module server-only — the API key must never reach the
// browser. All callers live in server actions.

const AYRSHARE_BASE = "https://api.ayrshare.com/api";

export type AyrsharePlatform =
  | "twitter"
  | "linkedin"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "youtube"
  | "pinterest"
  | "reddit"
  | "bluesky"
  | "threads";

export interface AyrsharePostRequest {
  post: string;
  platforms: AyrsharePlatform[];
  mediaUrls?: string[];
  /** ISO string. Omit to publish immediately. */
  scheduleDate?: string;
}

export interface AyrsharePostResult {
  ok: boolean;
  id?: string;
  /** Per-platform results — id + live URL where available. */
  postIds?: Array<{
    platform: string;
    id?: string;
    postUrl?: string;
    status?: string;
    error?: string;
  }>;
  error?: string;
}

async function ayrshareFetch<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${AYRSHARE_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      typeof body.message === "string"
        ? body.message
        : `Ayrshare ${res.status} ${res.statusText}`;
    throw new AyrshareError(msg, res.status, body);
  }
  return body as T;
}

export class AyrshareError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: Record<string, unknown>
  ) {
    super(message);
    this.name = "AyrshareError";
  }
}

/**
 * Post to one or more social networks. Returns per-platform results
 * so callers can persist partial successes (e.g. Twitter posted but
 * TikTok rate-limited).
 */
export async function postToAyrshare(
  apiKey: string,
  request: AyrsharePostRequest
): Promise<AyrsharePostResult> {
  try {
    const body = await ayrshareFetch<{
      status: string;
      id?: string;
      postIds?: AyrsharePostResult["postIds"];
      errors?: Array<{ platform: string; error: string }>;
    }>(apiKey, "/post", {
      method: "POST",
      body: JSON.stringify({
        post: request.post,
        platforms: request.platforms,
        mediaUrls: request.mediaUrls,
        scheduleDate: request.scheduleDate,
      }),
    });
    return {
      ok: body.status === "success" || body.status === "scheduled",
      id: body.id,
      postIds: body.postIds,
      error:
        body.errors && body.errors.length > 0
          ? body.errors.map((e) => `${e.platform}: ${e.error}`).join("; ")
          : undefined,
    };
  } catch (err) {
    if (err instanceof AyrshareError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Ayrshare request failed",
    };
  }
}

/**
 * Ping Ayrshare to verify the API key works. Returns the connected
 * platform count on success.
 */
export async function testAyrshareKey(
  apiKey: string
): Promise<{ ok: boolean; platforms?: string[]; error?: string }> {
  try {
    const body = await ayrshareFetch<{
      activeSocialAccounts?: string[];
    }>(apiKey, "/user");
    return {
      ok: true,
      platforms: body.activeSocialAccounts ?? [],
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Test call failed",
    };
  }
}
