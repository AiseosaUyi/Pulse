#!/usr/bin/env node
// End-to-end smoke for the cobalt pipeline. Resolves a URL via the
// configured cobalt instance, asserts SSRF allowlist, fetches bytes,
// hashes. Does NOT touch the database — pure pipeline verification.
//
// Usage:
//   node --env-file=.env.local scripts/smoke-cobalt.mjs <url>
//
// Requires COBALT_API_URL set in .env.local.

import { createHash } from "node:crypto";

const URL_ARG = process.argv[2];
if (!URL_ARG) {
  console.error("Usage: node scripts/smoke-cobalt.mjs <url>");
  process.exit(1);
}

const COBALT = process.env.COBALT_API_URL;
if (!COBALT) {
  console.error("COBALT_API_URL not set. Add it to .env.local first.");
  process.exit(1);
}

const ALLOWED_HOSTS = [
  /\.tiktokcdn(-[a-z]+)?\.com$/i,
  /\.cdninstagram\.com$/i,
  /\.fbcdn\.net$/i,
  /(^|\.)scontent(-[a-z0-9-]+)?\.[a-z0-9-]+\.(cdninstagram|fbcdn)\.(com|net)$/i,
  /\.twimg\.com$/i,
];

function isSafe(rawUrl, extraHost) {
  const u = new URL(rawUrl);
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (/^(127\.|10\.|192\.168\.|localhost)/.test(host)) return false;
  if (host === extraHost) return true;
  return ALLOWED_HOSTS.some((r) => r.test(host));
}

async function resolveViaCobalt(url) {
  const res = await fetch(COBALT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Pulse/1.0 smoke",
    },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`cobalt HTTP ${res.status}`);
  const body = await res.json();
  if (body.status === "error") {
    throw new Error(`cobalt error: ${body.error?.code ?? "unknown"}`);
  }
  if (body.status === "picker") {
    const first = body.picker?.find((p) => p.url);
    if (!first) throw new Error("picker response with no items");
    return { mediaUrl: first.url, filename: body.filename, kind: "picker→first" };
  }
  if (body.status === "tunnel" || body.status === "redirect") {
    return {
      mediaUrl: body.url,
      filename: body.filename,
      kind: body.status,
    };
  }
  throw new Error(`unexpected status: ${body.status}`);
}

async function fetchBytes(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; Pulse/1.0; +https://pulse.gruve.events)",
    },
  });
  if (!res.ok) throw new Error(`fetch HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log(`🎬 Target: ${URL_ARG}\n`);

  const cobaltHost = new URL(COBALT).hostname.toLowerCase();
  console.log(`→ cobalt: ${COBALT}`);

  // Step 1: resolve
  const t0 = Date.now();
  console.log("→ resolving via cobalt...");
  const r = await resolveViaCobalt(URL_ARG);
  console.log(`  ✓ ${Date.now() - t0}ms | status=${r.kind}`);
  console.log(`  filename: ${r.filename ?? "(none)"}`);
  console.log(`  media URL: ${r.mediaUrl.slice(0, 100)}...\n`);

  // Step 2: SSRF check
  console.log("→ SSRF allowlist check...");
  const host = new URL(r.mediaUrl).hostname.toLowerCase();
  if (!isSafe(r.mediaUrl, cobaltHost)) {
    throw new Error(`${host} is NOT on the allowlist`);
  }
  console.log(`  ✓ ${host} passes (${host === cobaltHost ? "cobalt tunnel" : "CDN redirect"})\n`);

  // Step 3: fetch bytes
  const t1 = Date.now();
  console.log("→ downloading bytes...");
  const bytes = await fetchBytes(r.mediaUrl);
  const dt = Date.now() - t1;
  const mb = (bytes.length / 1024 / 1024).toFixed(2);
  console.log(`  ✓ ${dt}ms | ${mb} MB (${bytes.length} bytes)\n`);

  // Step 4: hash
  const hash = createHash("sha256").update(bytes).digest("hex");
  console.log(`→ sha256: ${hash}\n`);

  console.log("✅ Pipeline works end-to-end (sans Supabase Storage upload).");
  console.log("   The vault extractor will do the same steps + upload.");
}

main().catch((err) => {
  console.error("❌ FAIL:", err.message);
  process.exit(1);
});
