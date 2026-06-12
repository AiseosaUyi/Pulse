// Google Search Console (Search Analytics) wrapper. Same service-account
// JWT flow as ga4.ts (RS256 → OAuth token → API call) — node:crypto signs,
// no extra deps.
//
// Tenant workflow:
//   1. Create a GCP service account (can reuse the GA4 one)
//   2. Add its client_email as a user on the GSC property
//      (Search Console → Settings → Users and permissions → Restricted)
//   3. Paste the property URL + service-account JSON into Pulse settings
//
// `siteUrl` is the GSC property identifier: either a URL-prefix property
// ("https://www.gruve.events/") or a Domain property ("sc-domain:gruve.events").

import { createSign } from "node:crypto";

export interface GscQueryRow {
  query: string;
  page: string;
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number; // average position (1 = top)
}

export class GscError extends Error {
  constructor(
    message: string,
    public status: number,
    public cause?: unknown
  ) {
    super(message);
    this.name = "GscError";
  }
}

interface ServiceAccountJson {
  client_email: string;
  private_key: string;
  project_id?: string;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function parseServiceAccount(raw: string): ServiceAccountJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GscError("Service account JSON is invalid", 400);
  }
  const obj = parsed as Partial<ServiceAccountJson>;
  if (!obj.client_email || !obj.private_key) {
    throw new GscError(
      "Service account JSON missing client_email or private_key",
      400
    );
  }
  return {
    client_email: obj.client_email,
    private_key: obj.private_key.replace(/\\n/g, "\n"),
    project_id: obj.project_id,
  };
}

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = parseServiceAccount(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const encode = (obj: unknown) => base64url(Buffer.from(JSON.stringify(obj)));
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key);
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new GscError(
      body.error_description || body.error || `Token exchange failed: ${res.status}`,
      res.status
    );
  }
  return body.access_token;
}

interface SearchAnalyticsResponse {
  rows?: Array<{
    keys?: string[]; // [query, page, date] in the order of dimensions requested
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
  error?: { message?: string };
}

/**
 * Pull one row per (query, page, date) for the window. GSC data lags ~2-3
 * days, so callers typically request the last few days each run.
 */
export async function fetchGscQueryDaily(opts: {
  siteUrl: string;
  serviceAccountJson: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  rowLimit?: number;
}): Promise<GscQueryRow[]> {
  const token = await getAccessToken(opts.serviceAccountJson);

  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
      opts.siteUrl
    )}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: ["query", "page", "date"],
        rowLimit: opts.rowLimit ?? 5000,
        dataState: "all",
      }),
    }
  );

  const parsed = (await res.json().catch(() => ({}))) as SearchAnalyticsResponse;
  if (!res.ok) {
    throw new GscError(parsed.error?.message ?? `GSC API ${res.status}`, res.status);
  }

  return (parsed.rows ?? []).map((row) => {
    const keys = row.keys ?? [];
    return {
      query: keys[0] ?? "",
      page: keys[1] ?? "",
      date: keys[2] ?? "",
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      ctr: Number(row.ctr ?? 0),
      position: Number(row.position ?? 0),
    };
  });
}

export async function testGscConnection(opts: {
  siteUrl: string;
  serviceAccountJson: string;
}): Promise<{ ok: boolean; totalClicks?: number; error?: string }> {
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 28 * 86_400_000);
    const rows = await fetchGscQueryDaily({
      siteUrl: opts.siteUrl,
      serviceAccountJson: opts.serviceAccountJson,
      startDate: from.toISOString().slice(0, 10),
      endDate: to.toISOString().slice(0, 10),
      rowLimit: 1000,
    });
    const totalClicks = rows.reduce((a, r) => a + r.clicks, 0);
    return { ok: true, totalClicks };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection test failed",
    };
  }
}
