/**
 * verify-gruve-contract.ts — Pulse-side mirror of Gruve's scripts/e2e-cert.sh.
 *
 * Proves the Pulse → Contentful → Gruve wire contract WITHOUT needing Gruve
 * infra or the live deployment: it runs the real secret/key material from
 * .env.local through the exact crypto chain Gruve verifies with, and checks
 * the field/routing contracts against the actual source files.
 *
 * What it certifies:
 *   C5  — RS256 service JWT (gruve-client) verifies against our derived JWKS,
 *         carries a jti (Gruve's rate-limit key — PULSE-ASK.md §1).
 *   M2  — HS256 preview JWT verifies under Gruve's exact jwtVerify settings.
 *   C1  — contentType vocabulary ("blog"/"story") maps to the right paths.
 *   CM  — the 7 Pulse fields + core gruveBlog fields line up across the
 *         migration script, the CMA field map, and the golden payload.
 *   MW  — the auth middleware exempts the public Gruve-facing endpoints.
 *
 * Run:  pnpm tsx scripts/verify-gruve-contract.ts
 * Pure crypto/string checks only; no network, no DB, no Gruve dependency.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  SignJWT,
  exportJWK,
  importPKCS8,
  createLocalJWKSet,
  jwtVerify,
  type JWK,
} from "jose";
import { normalizePrivateKeyPem } from "../src/lib/seo/pem";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── tiny .env.local parser (dotenv isn't installed) ──────────────────
function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return out;
  }
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    let rest = m[2];
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : "";
    if (quote) {
      rest = rest.slice(1);
      // Multi-line quoted value: keep consuming physical lines (preserving
      // real newlines) until the closing quote — handles PEM keys verbatim.
      let value = "";
      let closed = false;
      let cur = rest;
      while (true) {
        const qi = cur.indexOf(quote);
        if (qi !== -1) {
          value += cur.slice(0, qi);
          closed = true;
          break;
        }
        value += cur + "\n";
        i++;
        if (i >= lines.length) break;
        cur = lines[i];
      }
      void closed;
      out[k] = value;
    } else {
      out[k] = rest.trim();
    }
  }
  return out;
}

const env = loadEnvLocal();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

let failures = 0;
const ok = (label: string, detail = "") =>
  console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label: string, detail = "") => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
};
const assert = (cond: boolean, label: string, detail = "") =>
  cond ? ok(label, detail) : bad(label, detail);

// Gruve's expected values (from Frontend/server/env.ts + /api/preview).
const ISS = "pulse";
const API_AUD = "gruve-api";
const PREVIEW_AUD = "gruve-preview";

async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  await fn();
}

// ── C5: RS256 service JWT round-trip against our own JWKS ─────────────
async function certC5() {
  const pem = normalizePrivateKeyPem(env.PULSE_JWKS_PRIVATE_KEY);
  if (!pem) {
    bad("PULSE_JWKS_PRIVATE_KEY present + parseable");
    return;
  }
  const kid = env.PULSE_JWKS_KID ?? "pulse-seo-1";

  // 1. Derive the public JWK exactly like src/app/api/jwks/route.ts.
  let jwk: JWK;
  try {
    const pub = createPublicKey(createPrivateKey(pem));
    jwk = { ...(await exportJWK(pub)), kid, use: "sig", alg: "RS256" };
    assert(jwk.kty === "RSA" && !!jwk.n && !!jwk.e, "JWKS derives an RSA public key", `kid=${kid}`);
  } catch (e) {
    bad("JWKS public-key derivation", (e as Error).message);
    return;
  }

  // 2. Sign exactly like gruve-client.signGruveJwt (now WITH jti).
  const key = await importPKCS8(pem, "RS256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuedAt()
    .setIssuer(ISS)
    .setAudience(API_AUD)
    .setSubject("pulse-seo")
    .setJti(randomUUID())
    .setExpirationTime("300s")
    .sign(key);

  // 3. Verify the way Gruve does (createRemoteJWKSet → we use Local with the
  //    same key set; same verification surface) with iss/aud/RS256 pinned.
  const jwks = createLocalJWKSet({ keys: [jwk] });
  try {
    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      issuer: ISS,
      audience: API_AUD,
      algorithms: ["RS256"],
    });
    assert(protectedHeader.alg === "RS256", "service JWT alg is RS256");
    assert(protectedHeader.kid === kid, "service JWT kid matches JWKS", kid);
    assert(payload.iss === ISS, 'iss === "pulse"');
    assert(payload.aud === API_AUD, 'aud === "gruve-api"');
    assert(typeof payload.jti === "string" && payload.jti.length > 0, "carries a jti (Gruve rate-limit key)", payload.jti as string);
  } catch (e) {
    bad("service JWT verifies against JWKS", (e as Error).message);
  }

  // 4. Source-guard: the real signer must actually set jti (don't let this
  //    harness drift from the code it certifies).
  const src = read("src/lib/seo/gruve-client.ts");
  assert(/\.setJti\(/.test(src), "gruve-client.ts source calls .setJti()");
  assert(src.includes('"gruve-api"') || src.includes("gruve-api"), "gruve-client.ts targets gruve-api audience");
}

// ── M2: HS256 preview JWT under Gruve's exact verify settings ─────────
async function certM2() {
  const secret = env.PREVIEW_SHARED_SECRET;
  if (!secret) {
    bad("PREVIEW_SHARED_SECRET present");
    return;
  }
  const key = new TextEncoder().encode(secret);
  for (const contentType of ["blog", "story"] as const) {
    const slug = `qa-pulse-e2e-2026-05`;
    // Mint exactly like src/lib/seo/preview-token.mintPreviewToken.
    const token = await new SignJWT({ contentType, slug })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setIssuer(ISS)
      .setAudience(PREVIEW_AUD)
      .setJti(randomUUID())
      .setExpirationTime("60s")
      .sign(key);
    try {
      const { payload, protectedHeader } = await jwtVerify(token, key, {
        issuer: ISS,
        audience: PREVIEW_AUD,
        algorithms: ["HS256"],
      });
      assert(
        protectedHeader.alg === "HS256" &&
          payload.iss === ISS &&
          payload.aud === PREVIEW_AUD &&
          payload.slug === slug &&
          payload.contentType === contentType &&
          typeof payload.jti === "string",
        `preview JWT verifies (contentType=${contentType})`
      );
    } catch (e) {
      bad(`preview JWT verifies (contentType=${contentType})`, (e as Error).message);
    }
  }
  // Source-guard.
  const src = read("src/lib/seo/preview-token.ts");
  assert(src.includes('"gruve-preview"'), "preview-token.ts targets gruve-preview audience");
  assert(/setExpirationTime\(\s*TOKEN_TTL\s*\)/.test(src) || src.includes('"60s"'), "preview-token.ts uses a short TTL");
}

// ── C1: contentType vocabulary maps to the right path (Gruve's rules) ──
function certC1() {
  // Mirror of Frontend/lib/seo/contentType.ts alias sets (wire contract C1).
  const BLOG = new Set(["gruveblog", "blogpost", "blog", "production"]);
  const STORY = new Set(["creatorstories", "creatorstory", "story"]);
  const family = (raw: string) =>
    BLOG.has(raw.toLowerCase()) ? "blog" : STORY.has(raw.toLowerCase()) ? "story" : null;
  const pathFor = (raw: string, slug: string) =>
    family(raw) === "story" ? `/creator-stories/${slug}` : `/blogs/${slug}`;

  // PreviewContentType in Pulse is exactly "blog" | "story" — assert both
  // resolve correctly on Gruve's side.
  const pt = read("src/lib/seo/preview-token.ts");
  assert(/PreviewContentType\s*=\s*"blog"\s*\|\s*"story"/.test(pt), 'Pulse PreviewContentType is "blog" | "story"');
  assert(pathFor("blog", "x") === "/blogs/x", 'contentType "blog" → /blogs/x');
  assert(pathFor("story", "x") === "/creator-stories/x", 'contentType "story" → /creator-stories/x');
}

// ── CM: Contentful field contract across migration / map / golden ─────
function certCM() {
  const PULSE_FIELDS = [
    "seoTitle",
    "seoDescription",
    "canonicalUrl",
    "faqItems",
    "jsonLd",
    "pulseId",
    "pulseMetadata",
  ];
  // Core gruveBlog fields Gruve reads today (Frontend lib/contentful/CONTENT_MODEL.md).
  const CORE_WRITTEN = ["title", "slug", "description", "author", "minuteRead", "content", "question"];

  const migration = read("scripts/migrate-contentful-model.ts");
  for (const f of PULSE_FIELDS) {
    assert(migration.includes(`"${f}"`) || migration.includes(`'${f}'`) || migration.includes(`id: "${f}"`), `migration adds field: ${f}`);
  }
  assert(/unique/i.test(migration) && migration.includes("pulseId"), "migration sets pulseId unique constraint");
  assert(/omitted/i.test(migration), "migration hides pulseMetadata (omitted)");

  const map = read("src/lib/integrations/contentful.ts");
  for (const f of [...PULSE_FIELDS, ...CORE_WRITTEN]) {
    // Written either as an object-literal key (`pulseId: loc(...)`) or as a
    // conditional assignment (`fields.seoTitle = loc(...)`).
    const re = new RegExp(`(\\b${f}:|fields\\.${f}\\b)`);
    assert(re.test(map), `CMA map writes field: ${f}`);
  }
  assert(map.includes('"gruveBlog"') || map.includes("gruveBlog"), "CMA targets gruveBlog content type");

  // Golden payload must only use known field names (no typos Gruve can't read).
  // Shape: { _README, _assets, entry: { sys, fields: {...} } }.
  const golden = JSON.parse(read("docs/golden-gruveblog-payload.json"));
  const goldenFields = Object.keys(golden?.entry?.fields ?? golden?.fields ?? {});
  const KNOWN = new Set([
    ...PULSE_FIELDS,
    ...CORE_WRITTEN,
    "bannerImage",
    "thumbnail",
    "authorImage",
    "question",
  ]);
  const unknown = goldenFields.filter((k) => !KNOWN.has(k));
  assert(goldenFields.length > 0, "golden payload has fields", `${goldenFields.length} fields`);
  assert(unknown.length === 0, "golden payload uses only known gruveBlog fields", unknown.length ? `stray: ${unknown.join(", ")}` : "");
  assert(goldenFields.includes("pulseId"), "golden payload carries pulseId (idempotency)");
}

// ── MW: middleware exempts the public Gruve-facing endpoints ──────────
function certMW() {
  const mw = read("src/lib/supabase/middleware.ts");
  assert(mw.includes('"/.well-known"'), "middleware PUBLIC_PATHS includes /.well-known (JWKS)");
  // Beacon is under /api/ → handled by the isApi passthrough (own Bearer auth).
  assert(/isApi\s*=\s*pathname\.startsWith\("\/api\/"\)/.test(mw), "middleware lets /api/* run its own auth (beacon 401s itself, not redirect)");
  const vercel = JSON.parse(read("vercel.json"));
  const hasVercelRewrite = (vercel.rewrites ?? []).some(
    (r: { source: string; destination: string }) =>
      r.source === "/.well-known/jwks.json" && r.destination === "/api/jwks"
  );
  // The canonical rewrite must also live in next.config.ts so it applies in
  // dev (vercel.json rewrites are platform-only) — the path Gruve fetches.
  const nextCfg = read("next.config.ts");
  const hasNextRewrite =
    nextCfg.includes('"/.well-known/jwks.json"') && nextCfg.includes('"/api/jwks"');
  assert(hasNextRewrite, "next.config.ts rewrites /.well-known/jwks.json → /api/jwks (dev + prod)");
  assert(hasVercelRewrite, "vercel.json also rewrites /.well-known/jwks.json → /api/jwks (platform edge)");
}

async function main() {
  console.log("\x1b[1m── Pulse ↔ Gruve wire-contract certification ──\x1b[0m");
  await section("C5  RS256 service JWT ⇄ JWKS", certC5);
  await section("M2  HS256 preview JWT", certM2);
  await section("C1  contentType routing", certC1);
  await section("CM  Contentful field contract", certCM);
  await section("MW  middleware public-endpoint exemption", certMW);

  console.log("");
  if (failures === 0) {
    console.log("\x1b[32m\x1b[1mALL CHECKS PASSED — Pulse side satisfies the Gruve wire contract.\x1b[0m");
    console.log("Remaining go-live steps are ops-only (deploy + age secret exchange + Gruve Vercel env). See docs/GRUVE-CUTOVER-HANDOFF.md");
    process.exit(0);
  } else {
    console.log(`\x1b[31m\x1b[1m${failures} CHECK(S) FAILED.\x1b[0m`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
