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
const BASE = process.env.GRUVE_API_BASE_URL; // e.g. https://gruve.events

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

// ── The 6 Pulse-facing endpoints (C5) ────────────────────────────────
// Names are placeholders; wire them to gruveApiGet with real paths/types
// when C5 arrives. Throwing keeps callers honest until then.
const pending = (name: string) => {
  throw new GruveContractPendingError(name);
};

export const gruve = {
  // e.g. published post performance, keyword positions, backlinks, etc.
  getPostPerformance: (_slug: string): Promise<never> =>
    pending("getPostPerformance"),
  getKeywordPositions: (_slug: string): Promise<never> =>
    pending("getKeywordPositions"),
  getBacklinks: (_slug: string): Promise<never> => pending("getBacklinks"),
  getSiteTaxonomy: (): Promise<never> => pending("getSiteTaxonomy"),
  getPublishedIndex: (): Promise<never> => pending("getPublishedIndex"),
  getTrafficSummary: (_range: string): Promise<never> =>
    pending("getTrafficSummary"),
};
