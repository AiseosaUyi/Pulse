/**
 * check-contentful-model.ts — READ-ONLY Contentful connectivity + readiness check.
 *
 * Verifies the CMA token works and reports whether the 7-field model migration
 * has run on `gruveBlog`, and whether the QA smoke entry already exists. Makes
 * only GET calls — never creates, updates, or publishes anything. Safe to run
 * anytime. Never prints the token.
 *
 * Run:  pnpm check:contentful
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "contentful-management";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  let raw: string;
  try { raw = readFileSync(join(ROOT, ".env.local"), "utf8"); } catch { return; }
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    let rest = m[2];
    const q = rest[0] === '"' || rest[0] === "'" ? rest[0] : "";
    if (q) {
      rest = rest.slice(1); let value = ""; let cur = rest;
      while (true) { const qi = cur.indexOf(q); if (qi !== -1) { value += cur.slice(0, qi); break; } value += cur + "\n"; if (++i >= lines.length) break; cur = lines[i]; }
      if (process.env[k] === undefined) process.env[k] = value;
    } else if (process.env[k] === undefined) process.env[k] = rest.trim();
  }
}
loadEnvLocal();

const SPACE = process.env.CONTENTFUL_SPACE_ID;
const CMA = process.env.CONTENTFUL_CMA_TOKEN;
const ENVIRONMENT = process.env.CONTENTFUL_ENVIRONMENT ?? "master";
const PULSE_FIELDS = ["seoTitle", "seoDescription", "canonicalUrl", "faqItems", "jsonLd", "pulseId", "pulseMetadata"];
const SLUG = "qa-pulse-e2e-2026-05";

async function main() {
  if (!SPACE || !CMA) {
    console.log("✗ Missing CONTENTFUL_SPACE_ID or CONTENTFUL_CMA_TOKEN in .env.local");
    process.exit(1);
  }
  const client = createClient({ accessToken: CMA }, { type: "legacy" });
  console.log(`Connecting to space ${SPACE} / env ${ENVIRONMENT} …`);
  const space = await client.getSpace(SPACE);
  const env = await space.getEnvironment(ENVIRONMENT);
  console.log(`✓ Token works — connected as space "${space.name}".`);

  const ct = await env.getContentType("gruveBlog");
  const ids = new Set(ct.fields.map((f) => f.id));
  console.log(`\ngruveBlog content type: ${ct.fields.length} fields.`);
  let missing = 0;
  for (const f of PULSE_FIELDS) {
    const present = ids.has(f);
    if (!present) missing++;
    console.log(`  ${present ? "✓" : "✗"} ${f}`);
  }

  if (ids.has("pulseId")) {
    const entries = await env.getEntries({ content_type: "gruveBlog", "fields.pulseId": SLUG, limit: 1 });
    console.log(`\nQA smoke entry (pulseId=${SLUG}): ${entries.items.length ? "exists" : "not present"}`);
  } else {
    console.log(`\nQA smoke entry: can't check yet (pulseId field doesn't exist pre-migration).`);
  }

  console.log("");
  if (missing === 0) {
    console.log("\x1b[32mREADY: migration applied. `pnpm smoke:publish` will publish the QA post.\x1b[0m");
  } else {
    console.log(`\x1b[33mMIGRATION NEEDED: ${missing}/7 Pulse fields missing.\x1b[0m`);
    console.log("Run once (mutates Gruve PROD content model — additive/idempotent):");
    console.log("  pnpm tsx scripts/migrate-contentful-model.ts");
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  // Don't leak token; surface only the failure class.
  console.error("\x1b[31mcheck failed:\x1b[0m", msg.replace(/CFPAT-[A-Za-z0-9_-]+/g, "CFPAT-***"));
  if (/AccessTokenInvalid|401|Unauthorized/i.test(msg)) console.error("  → The CMA token appears invalid or lacks access to this space.");
  process.exit(1);
});
