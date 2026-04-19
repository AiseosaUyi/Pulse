// WordPress REST wrapper. Uses the wp/v2 endpoint + HTTP Basic auth
// with an Application Password. Server-only — credentials never leave
// the server.
//
// Docs: https://developer.wordpress.org/rest-api/reference/posts/

export interface WordpressPostRequest {
  title: string;
  content: string;
  status: "draft" | "publish";
  slug?: string;
  excerpt?: string;
  /** Category slugs — we resolve them to IDs before post. */
  categories?: string[];
}

export interface WordpressPostResult {
  ok: boolean;
  id?: number;
  url?: string;
  error?: string;
}

export class WordpressError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "WordpressError";
  }
}

function buildBasicAuth(username: string, appPassword: string): string {
  // App passwords contain spaces — strip per WP docs.
  const clean = appPassword.replace(/\s+/g, "");
  const encoded = Buffer.from(`${username}:${clean}`).toString("base64");
  return `Basic ${encoded}`;
}

function wpBase(siteUrl: string): string {
  const trimmed = siteUrl.replace(/\/+$/, "");
  return `${trimmed}/wp-json/wp/v2`;
}

async function wpFetch<T>(
  siteUrl: string,
  username: string,
  appPassword: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${wpBase(siteUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: buildBasicAuth(username, appPassword),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `WordPress ${res.status} ${res.statusText}`;
    throw new WordpressError(msg, res.status);
  }
  return body as T;
}

async function resolveCategorySlugs(
  siteUrl: string,
  username: string,
  appPassword: string,
  slugs: string[]
): Promise<number[]> {
  if (slugs.length === 0) return [];
  const params = new URLSearchParams();
  params.set("slug", slugs.join(","));
  params.set("per_page", String(Math.min(100, slugs.length)));
  const data = await wpFetch<Array<{ id: number }>>(
    siteUrl,
    username,
    appPassword,
    `/categories?${params.toString()}`
  );
  return data.map((c) => c.id);
}

export async function publishToWordpress(
  creds: { siteUrl: string; username: string; appPassword: string },
  request: WordpressPostRequest
): Promise<WordpressPostResult> {
  try {
    const categoryIds = request.categories
      ? await resolveCategorySlugs(
          creds.siteUrl,
          creds.username,
          creds.appPassword,
          request.categories
        )
      : undefined;

    const body = await wpFetch<{ id: number; link: string }>(
      creds.siteUrl,
      creds.username,
      creds.appPassword,
      "/posts",
      {
        method: "POST",
        body: JSON.stringify({
          title: request.title,
          content: request.content,
          status: request.status,
          slug: request.slug,
          excerpt: request.excerpt,
          categories: categoryIds,
        }),
      }
    );

    return { ok: true, id: body.id, url: body.link };
  } catch (err) {
    if (err instanceof WordpressError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "WordPress publish failed",
    };
  }
}

export async function testWordpressConnection(creds: {
  siteUrl: string;
  username: string;
  appPassword: string;
}): Promise<{ ok: boolean; error?: string; siteName?: string }> {
  try {
    const body = await wpFetch<{ name?: string }>(
      creds.siteUrl,
      creds.username,
      creds.appPassword,
      // GET current user verifies the auth path.
      "/users/me?context=edit"
    );
    return { ok: true, siteName: body.name };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection test failed",
    };
  }
}
