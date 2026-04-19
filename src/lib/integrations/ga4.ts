// GA4 Data API wrapper. Uses a service-account JWT (RS256) exchanged
// for an OAuth access token, then calls the runReport endpoint.
// No extra dependencies — node:crypto handles the RSA signing.
//
// Tenant workflow:
//   1. Create a GCP service account
//   2. Grant "Viewer" access to their GA4 property
//   3. Download the JSON key
//   4. Paste property ID + JSON into Pulse settings
//
// Cheaper alternative to the full OAuth dance and good enough for
// a single-brand MVP.

import { createSign } from "node:crypto";

export interface ServiceAccountJson {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface Ga4PageRow {
  pagePath: string;
  date: string; // YYYY-MM-DD
  pageviews: number;
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number;
  conversions: number;
}

export class Ga4Error extends Error {
  constructor(
    message: string,
    public status: number,
    public cause?: unknown
  ) {
    super(message);
    this.name = "Ga4Error";
  }
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
    throw new Ga4Error("Service account JSON is invalid", 400);
  }
  const obj = parsed as Partial<ServiceAccountJson>;
  if (!obj.client_email || !obj.private_key) {
    throw new Ga4Error(
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

async function getAccessToken(
  serviceAccountJson: string
): Promise<{ token: string; expiresAt: number }> {
  const sa = parseServiceAccount(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const encode = (obj: unknown) =>
    base64url(Buffer.from(JSON.stringify(obj)));
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
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Ga4Error(
      body.error_description ||
        body.error ||
        `Token exchange failed: ${res.status}`,
      res.status
    );
  }
  return {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600) - 30,
  };
}

type GaValueRow = {
  dimensionValues: Array<{ value?: string }>;
  metricValues: Array<{ value?: string }>;
};

async function runReport(
  propertyId: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<{ rows?: GaValueRow[]; rowCount?: number }> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(
      propertyId
    )}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const parsed = (await res.json().catch(() => ({}))) as {
    rows?: GaValueRow[];
    rowCount?: number;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Ga4Error(
      parsed.error?.message ?? `GA4 API ${res.status}`,
      res.status
    );
  }
  return parsed;
}

/**
 * Pull one row per (page, date) for the requested window, with the
 * metrics we surface in Pulse. Returns normalized rows ready to
 * upsert into web_analytics_daily.
 */
export async function fetchGa4DailyByPage(opts: {
  propertyId: string;
  serviceAccountJson: string;
  startDate: string; // YYYY-MM-DD or NdaysAgo
  endDate: string; // YYYY-MM-DD or 'today'
}): Promise<Ga4PageRow[]> {
  const { token } = await getAccessToken(opts.serviceAccountJson);

  const result = await runReport(opts.propertyId, token, {
    dateRanges: [{ startDate: opts.startDate, endDate: opts.endDate }],
    dimensions: [{ name: "pagePath" }, { name: "date" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "userEngagementDuration" },
      { name: "bounceRate" },
      { name: "conversions" },
    ],
    limit: 10000,
    orderBys: [{ dimension: { dimensionName: "date" } }],
  });

  const rows = result.rows ?? [];
  return rows.map((row) => {
    const dims = row.dimensionValues ?? [];
    const metrics = row.metricValues ?? [];
    const pagePath = dims[0]?.value ?? "/";
    const dateRaw = dims[1]?.value ?? "";
    // GA4 returns dates as YYYYMMDD. Normalize to YYYY-MM-DD.
    const date =
      dateRaw.length === 8
        ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
        : dateRaw;
    return {
      pagePath,
      date,
      pageviews: Number(metrics[0]?.value ?? 0),
      sessions: Number(metrics[1]?.value ?? 0),
      users: Number(metrics[2]?.value ?? 0),
      engagementTimeSec: Math.round(Number(metrics[3]?.value ?? 0)),
      bounceRate: Number(metrics[4]?.value ?? 0),
      conversions: Number(metrics[5]?.value ?? 0),
    };
  });
}

export async function testGa4Connection(opts: {
  propertyId: string;
  serviceAccountJson: string;
}): Promise<{
  ok: boolean;
  totalUsers?: number;
  error?: string;
}> {
  try {
    const { token } = await getAccessToken(opts.serviceAccountJson);
    const result = await runReport(opts.propertyId, token, {
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      metrics: [{ name: "totalUsers" }],
    });
    const totalUsers = Number(
      result.rows?.[0]?.metricValues?.[0]?.value ?? 0
    );
    return { ok: true, totalUsers };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Connection test failed",
    };
  }
}
