// Preview token minting (PULSE-SEO-SPEC.md §13). Pulse mints a short
// HS256 JWT; Gruve's /api/preview verifies it and renders the draft.
// Every minted jti is recorded in seo_preview_jti (5-min ledger) so a
// replay can be rejected; the ledger is swept by the preview-jti cron
// (§16). Gruve-side verification/rejection is [GRUVE-PENDING] (needs the
// shared secret); the issuer ledger is built now regardless.

import "server-only";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createAdminClient } from "@/lib/supabase/admin";

const SECRET = process.env.PREVIEW_SHARED_SECRET;
const GRUVE_BASE =
  process.env.GRUVE_PREVIEW_BASE_URL ?? "https://gruve.events";
const JTI_TTL_MS = 5 * 60_000; // ledger window
const TOKEN_TTL = "60s"; // jwt exp

export type PreviewContentType = "blog" | "story";

export class PreviewNotConfiguredError extends Error {
  constructor() {
    super("PREVIEW_SHARED_SECRET is not set — cannot mint preview tokens.");
    this.name = "PreviewNotConfiguredError";
  }
}

export function isPreviewConfigured(): boolean {
  return Boolean(SECRET);
}

export interface MintedPreview {
  token: string;
  jti: string;
  url: string;
  expiresInSeconds: number;
}

export async function mintPreviewToken(args: {
  slug: string;
  contentType?: PreviewContentType;
}): Promise<MintedPreview> {
  if (!SECRET) throw new PreviewNotConfiguredError();
  const jti = randomUUID();
  const contentType = args.contentType ?? "blog";
  const key = new TextEncoder().encode(SECRET);

  const token = await new SignJWT({ contentType, slug: args.slug })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("pulse")
    .setAudience("gruve-preview")
    .setJti(jti)
    .setExpirationTime(TOKEN_TTL)
    .sign(key);

  // Record the jti (best-effort; mint must not fail if the ledger write
  // blips — the token is still valid and short-lived).
  try {
    const supabase = createAdminClient();
    await supabase.from("seo_preview_jti").insert({
      jti,
      expires_at: new Date(Date.now() + JTI_TTL_MS).toISOString(),
    });
  } catch {
    /* ledger is advisory; swallow */
  }

  const url = `${GRUVE_BASE}/api/preview?token=${encodeURIComponent(
    token
  )}&slug=${encodeURIComponent(args.slug)}`;

  return { token, jti, url, expiresInSeconds: 60 };
}

/** True if the jti is unused within its window (for a future verify path). */
export async function isPreviewJtiFresh(jti: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("seo_preview_jti")
    .select("jti, expires_at")
    .eq("jti", jti)
    .maybeSingle();
  if (!data) return true; // never issued here → not a known replay
  return new Date(data.expires_at).getTime() < Date.now();
}

/** Delete expired ledger rows. Called by the preview-jti cron (§16). */
export async function sweepPreviewJti(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("seo_preview_jti")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("jti");
  if (error) throw new Error(`preview jti sweep: ${error.message}`);
  return data?.length ?? 0;
}
