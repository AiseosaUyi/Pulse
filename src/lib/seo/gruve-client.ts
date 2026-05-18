// Gruve Pulse-facing data reads (PULSE-SEO-SPEC.md §15, wire contract
// C5). The RS256 signer + authenticated fetch are REAL and usable now;
// Gruve verifies via our JWKS (/.well-known/jwks.json). The 6 specific
// endpoints are [GRUVE-PENDING] — paths/params/shapes unknown until C5,
// so they throw rather than guess. Fill `GRUVE_ENDPOINTS` + the typed
// wrappers when C5 lands; nothing else changes.

import "server-only";
import { SignJWT, importPKCS8 } from "jose";

const PRIVATE_PEM = process.env.PULSE_JWKS_PRIVATE_KEY;
const KID = process.env.PULSE_JWKS_KID ?? "pulse-seo-1";
const ISS = "pulse";
const AUD = process.env.GRUVE_API_AUDIENCE ?? "gruve-api";
// Gruve confirmed canonical base is www.
const BASE = process.env.GRUVE_API_BASE_URL ?? "https://www.gruve.events";

export class GruveNotConfiguredError extends Error {
  constructor() {
    super(
      "Gruve client not configured — set PULSE_JWKS_PRIVATE_KEY and GRUVE_API_BASE_URL."
    );
    this.name = "GruveNotConfiguredError";
  }
}

export class GruveContractPendingError extends Error {
  constructor(endpoint: string) {
    super(
      `Gruve endpoint '${endpoint}' is pending wire contract C5 (path/params/shape unknown).`
    );
    this.name = "GruveContractPendingError";
  }
}

export function isGruveConfigured(): boolean {
  return Boolean(PRIVATE_PEM && BASE);
}

/** Mint a short-lived RS256 JWT Gruve verifies against our JWKS. */
export async function signGruveJwt(
  subject = "pulse-seo",
  ttlSeconds = 300
): Promise<string> {
  if (!PRIVATE_PEM) throw new GruveNotConfiguredError();
  const key = await importPKCS8(PRIVATE_PEM, "RS256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(ISS)
    .setAudience(AUD)
    .setSubject(subject)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

/** Authenticated GET against Gruve. Real once env + a path are known. */
export async function gruveApiGet<T = unknown>(
  path: string,
  params?: Record<string, string | number>
): Promise<T> {
  if (!isGruveConfigured()) throw new GruveNotConfiguredError();
  const token = await signGruveJwt();
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params ?? {}))
    url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Gruve ${path} → ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Authenticated POST against Gruve. */
export async function gruveApiPost<T = unknown>(
  path: string,
  body?: unknown
): Promise<T> {
  if (!isGruveConfigured()) throw new GruveNotConfiguredError();
  const token = await signGruveJwt();
  const res = await fetch(new URL(path, BASE), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Gruve ${path} → ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// ── The 6 Pulse-facing endpoints (C5 — exact contracts from Gruve) ────
// All cursor-paginated by ISO date; 60 req/min/token. Until Gruve
// provisions its analytics DB these return { data: [] } with auth still
// enforced — callers degrade gracefully (no special-casing needed).
type DateRange = { slug?: string; from: string; to: string };

export interface EngagementRow {
  date: string;
  slug: string;
  views: number;
  unique_views: number;
  dwell_p50_ms: number;
  dwell_p90_ms: number;
  scroll_p50: number;
  scroll_p90: number;
  internal_links: number;
  outbound_clicks: number;
  cta_clicks: number;
  to_event_clicks: number;
  conversions: number;
}
export interface ConversionRow {
  date: string;
  slug: string;
  views: number;
  to_event_clicks: number;
  conversions: number;
}
export interface CrawlerRow {
  date: string;
  slug: string;
  bot_class: string;
  hits: number;
}
export interface EventsTrafficRow {
  slug: string;
  clicks: number;
  sessions: number;
}
export interface InternalLinkRow {
  from_slug: string;
  to_slug: string;
  anchor: string;
  observed: string;
}
type Page<T> = { data: T[]; nextCursor?: string | null };

export const gruve = {
  engagement: (
    q: DateRange & { cursor?: string; limit?: number }
  ): Promise<Page<EngagementRow>> =>
    gruveApiGet("/api/pulse/engagement", {
      ...(q.slug ? { slug: q.slug } : {}),
      from: q.from,
      to: q.to,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    }),
  conversions: (q: DateRange): Promise<Page<ConversionRow>> =>
    gruveApiGet("/api/pulse/conversions", {
      ...(q.slug ? { slug: q.slug } : {}),
      from: q.from,
      to: q.to,
    }),
  crawlers: (q: DateRange): Promise<Page<CrawlerRow>> =>
    gruveApiGet("/api/pulse/crawlers", {
      ...(q.slug ? { slug: q.slug } : {}),
      from: q.from,
      to: q.to,
    }),
  eventsTraffic: (
    eventAddress: string
  ): Promise<{ eventAddress: string; data: EventsTrafficRow[] }> =>
    gruveApiGet("/api/pulse/events-traffic", { eventAddress }),
  internalLinkGraph: (): Promise<{ data: InternalLinkRow[] }> =>
    gruveApiGet("/api/pulse/internal-link-graph"),
  reindex: (): Promise<{ ok: boolean; triggered: boolean }> =>
    gruveApiPost("/api/pulse/reindex"),
};
