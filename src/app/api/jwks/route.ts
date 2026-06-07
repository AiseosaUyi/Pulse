// Pulse JWKS — public keys Gruve uses to verify Pulse-signed (RS256)
// JWTs on its Pulse-facing data APIs (PULSE-SEO-SPEC.md §15, C5).
// Served at https://pulse-ashy-kappa.vercel.app/.well-known/jwks.json
// via the rewrite in vercel.json.
//
// SCAFFOLD: inert until C5 lands. Set PULSE_JWKS_PRIVATE_KEY (PKCS8 PEM,
// RS256) + PULSE_JWKS_KID and this serves the derived public JWK. Until
// then it returns an empty key set (valid JWKS, nothing to verify yet).

import { NextResponse } from "next/server";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { exportJWK } from "jose";
import { normalizePrivateKeyPem } from "@/lib/seo/pem";

export const dynamic = "force-dynamic";

export async function GET() {
  const pem = normalizePrivateKeyPem(process.env.PULSE_JWKS_PRIVATE_KEY);
  const kid = process.env.PULSE_JWKS_KID ?? "pulse-seo-1";

  if (!pem) {
    // Valid empty JWKS — Gruve can fetch it now; keys appear when C5 is wired.
    return NextResponse.json(
      { keys: [] },
      { headers: { "cache-control": "public, max-age=60" } }
    );
  }

  try {
    const publicKey = createPublicKey(createPrivateKey(pem));
    const jwk = await exportJWK(publicKey);
    return NextResponse.json(
      {
        keys: [{ ...jwk, kid, use: "sig", alg: "RS256" }],
      },
      { headers: { "cache-control": "public, max-age=3600" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "jwks export failed" },
      { status: 500 }
    );
  }
}
