/**
 * smoke-cleanup.ts — unpublish (and optionally delete) the QA smoke post.
 *
 *   pnpm tsx scripts/smoke-cleanup.ts            # unpublish (keeps the entry/draft)
 *   pnpm tsx scripts/smoke-cleanup.ts --delete   # unpublish + delete entirely
 *
 * Targets the fixed QA slug published by scripts/publish-smoke.ts. Read-safe:
 * does nothing if the entry isn't found. Never prints the token.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "contentful-management";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^(CONTENTFUL_[A-Z_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const SLUG = "qa-pulse-e2e-2026-05";
const DELETE = process.argv.includes("--delete");

async function main() {
  const SPACE = process.env.CONTENTFUL_SPACE_ID;
  const CMA = process.env.CONTENTFUL_CMA_TOKEN;
  if (!SPACE || !CMA) { console.log("Missing CONTENTFUL_SPACE_ID/CMA token — nothing to do."); return; }
  const client: any = createClient({ accessToken: CMA }, { type: "legacy" } as any);
  const space = await client.getSpace(SPACE);
  const env = await space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT ?? "master");

  const res = await env.getEntries({ content_type: "gruveBlog", "fields.pulseId": SLUG, limit: 1 });
  if (!res.items.length) { console.log(`No QA entry (pulseId=${SLUG}) found — already clean.`); return; }
  let entry = res.items[0];
  if (entry.sys.publishedVersion) {
    entry = await entry.unpublish();
    console.log(`✓ unpublished ${entry.sys.id} (removed from live site + sitemap)`);
  } else {
    console.log(`• ${entry.sys.id} was already unpublished`);
  }
  if (DELETE) {
    await entry.delete();
    console.log(`✓ deleted ${SLUG} entry entirely`);
  } else {
    console.log("  (entry kept as draft — re-run `pnpm smoke:publish` to verify again)");
  }
}

main().catch((e) => { console.error("cleanup failed:", e instanceof Error ? e.message : e); process.exit(1); });
