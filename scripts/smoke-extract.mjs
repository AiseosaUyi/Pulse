#!/usr/bin/env node
// End-to-end smoke for the TikTok extractor pipeline — without touching
// the database. Verifies: platform detection → tikwm resolve → SSRF
// guard → byte fetch → sha256. Run with `node --env-file=.env.local
// scripts/smoke-extract.mjs <tiktok-url>`.
//
// Prints everything you'd need to confirm the live pipeline works
// before flipping the "Extract & save" button.

import { createHash } from "node:crypto";

const DEFAULT_URL =
  process.argv[2] ??
  "https://www.tiktok.com/@god_zwillll/video/7626364498403691797";

const ALLOWED_HOSTS = [
  /\.tiktokcdn(-[a-z]+)?\.com$/i,
  /\.tiktokcdn\.(com|us|eu)$/i,
  /\.ttwstatic\.com$/i,
];

const PRIVATE_IPS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
];

function assertSafeUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`Bad protocol: ${url.protocol}`);
  const host = url.hostname.toLowerCase();
  if (PRIVATE_IPS.some((r) => r.test(host))) throw new Error(`Private host: ${host}`);
  if (host === "localhost") throw new Error("localhost rejected");
  if (!ALLOWED_HOSTS.some((r) => r.test(host))) {
    throw new Error(`Host not in allowlist: ${host}`);
  }
  return url;
}

async function resolveTikTok(url) {
  const body = new URLSearchParams({ url, hd: "1" });
  const res = await fetch("https://www.tikwm.com/api/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "Pulse/1.0 smoke",
    },
    body,
  });
  if (!res.ok) throw new Error(`tikwm HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`tikwm: ${json.msg}`);
  return json.data;
}

async function fetchBytes(url) {
  assertSafeUrl(url);
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; Pulse/1.0; +https://pulse.gruve.events)",
    },
  });
  if (!res.ok) throw new Error(`fetch HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function main() {
  console.log(`🎬 Target: ${DEFAULT_URL}\n`);

  // Step 1: resolve
  const t0 = Date.now();
  console.log("→ resolving via tikwm...");
  const d = await resolveTikTok(DEFAULT_URL);
  console.log(
    `  ✓ ${Date.now() - t0}ms | title="${(d.title ?? "").slice(0, 60)}..."`
  );
  console.log(`  author=@${d.author?.unique_id ?? "?"} duration=${d.duration}s`);
  const video = d.hdplay || d.play;
  const thumb = d.cover || d.origin_cover;
  console.log(`  video=${video.slice(0, 80)}...`);
  console.log(`  thumb=${(thumb ?? "").slice(0, 80)}...\n`);

  // Step 2: SSRF guard
  console.log("→ checking SSRF allowlist...");
  const safe = assertSafeUrl(video);
  console.log(`  ✓ ${safe.hostname} is on allowlist\n`);

  // Step 3: fetch bytes
  const t1 = Date.now();
  console.log("→ downloading video bytes...");
  const bytes = await fetchBytes(video);
  const dt = Date.now() - t1;
  const mb = (bytes.length / 1024 / 1024).toFixed(2);
  console.log(`  ✓ ${dt}ms | ${mb} MB (${bytes.length} bytes)\n`);

  // Step 4: hash
  console.log("→ computing sha256...");
  const hash = createHash("sha256").update(bytes).digest("hex");
  console.log(`  ✓ ${hash}\n`);

  console.log("✅ Pipeline works end-to-end (sans Supabase Storage upload).");
  console.log(
    "   Next: apply migration 021 in Supabase, then click 'Extract & save' in /content-vault."
  );
}

main().catch((err) => {
  console.error("❌ FAIL:", err.message);
  process.exit(1);
});
