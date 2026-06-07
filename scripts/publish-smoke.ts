/**
 * publish-smoke.ts — one-command Pulse → Contentful → Gruve publish test.
 *
 * Upserts (idempotent by pulseId) + publishes a single fixed QA blog entry to
 * Gruve's Contentful space, then prints the Gruve URL to eyeball. Re-running
 * updates the same entry, never duplicates.
 *
 * This is a SELF-CONTAINED smoke harness: it talks to contentful-management
 * directly and mirrors the field mapping in src/lib/integrations/contentful.ts
 * (which `pnpm verify:gruve` certifies field-for-field). It deliberately does
 * not import the app's server-only modules so it runs as a plain script.
 *
 * PREREQUISITES (both CTO-gated, see docs/GRUVE-CUTOVER-HANDOFF.md):
 *   1. CONTENTFUL_CMA_TOKEN in .env.local (write token from Gruve, via age).
 *   2. The 7-field model migration already run (scripts/migrate-contentful-model.ts)
 *      — else Contentful rejects the pulseId / pulseMetadata fields.
 *
 * Until the CMA token is present it prints what's missing and exits 0.
 *
 * Run:  pnpm smoke:publish
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "contentful-management";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env.local (handles multi-line quoted values like PEM keys).
function loadEnvLocal() {
  let raw: string;
  try {
    raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    let rest = m[2];
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : "";
    if (quote) {
      rest = rest.slice(1);
      let value = "";
      let cur = rest;
      while (true) {
        const qi = cur.indexOf(quote);
        if (qi !== -1) { value += cur.slice(0, qi); break; }
        value += cur + "\n";
        if (++i >= lines.length) break;
        cur = lines[i];
      }
      if (process.env[k] === undefined) process.env[k] = value;
    } else if (process.env[k] === undefined) {
      process.env[k] = rest.trim();
    }
  }
}

loadEnvLocal();

const SLUG = "qa-pulse-e2e-2026-05";
const SPACE = process.env.CONTENTFUL_SPACE_ID;
const CMA_TOKEN = process.env.CONTENTFUL_CMA_TOKEN;
const ENVIRONMENT = process.env.CONTENTFUL_ENVIRONMENT ?? "master";
const LOCALE = process.env.CONTENTFUL_DEFAULT_LOCALE ?? "en-US";
const CONTENT_TYPE = "gruveBlog";
const GRUVE_BASE = process.env.GRUVE_PREVIEW_BASE_URL ?? "https://www.gruve.events";

const loc = (v: unknown) => ({ [LOCALE]: v });

// Minimal-but-valid Contentful RichText document.
const bodyRichText = {
  nodeType: "document",
  data: {},
  content: [
    {
      nodeType: "paragraph",
      data: {},
      content: [
        {
          nodeType: "text",
          value:
            "QA smoke post from Pulse — verifying the Pulse → Contentful → Gruve publish loop end to end.",
          marks: [],
          data: {},
        },
      ],
    },
  ],
};

const assetLink = (id: string) => loc({ sys: { type: "Link", linkType: "Asset", id } });

// gruveBlog REQUIRES question + bannerImage + thumbnail + authorImage. Reuse an
// existing published asset for the three image links (fast); else upload one.
async function findOrCreateAssetId(env: any): Promise<string> {
  const assets = await env.getAssets({ limit: 20 });
  const published = assets.items.find((a: any) => a.sys.publishedVersion);
  if (published) {
    console.log(`      reusing published asset ${published.sys.id} for image fields`);
    return published.sys.id;
  }
  console.log("      no published asset found — uploading a placeholder…");
  let asset = await env.createAsset({
    fields: {
      title: loc("Pulse QA placeholder"),
      file: loc({ contentType: "image/png", fileName: "qa-placeholder.png", upload: "https://placehold.co/1200x630/png" }),
    },
  });
  asset = await asset.processForAllLocales();
  for (let i = 0; i < 15; i++) {
    asset = await env.getAsset(asset.sys.id);
    const f: any = Object.values(asset.fields?.file ?? {})[0];
    if (f?.url) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  asset = await asset.publish();
  return asset.sys.id;
}

// Mirrors mapToGruveBlogFields() in src/lib/integrations/contentful.ts, plus the
// gruveBlog-required fields the mapper currently omits (question + images).
function buildFields(assetId: string) {
  const fields: Record<string, Record<string, unknown>> = {
    title: loc("QA: Pulse → Contentful → Gruve smoke test"),
    slug: loc(SLUG),
    content: loc(bodyRichText),
    pulseId: loc(SLUG), // idempotency key (unique constraint on the content type)
    description: loc("Automated smoke-test entry published by scripts/publish-smoke.ts."),
    question: loc("Does the Pulse → Contentful → Gruve loop work end to end?"),
    author: loc("Pulse QA"),
    minuteRead: loc(1),
    bannerImage: assetLink(assetId),
    thumbnail: assetLink(assetId),
    authorImage: assetLink(assetId),
    pulseMetadata: loc({ source: "publish-smoke", generatedBy: "scripts/publish-smoke.ts" }),
  };
  return fields;
}

async function main() {
  if (!SPACE || !CMA_TOKEN) {
    console.log("\x1b[33m⏳ Not ready to publish yet.\x1b[0m");
    console.log(`  CONTENTFUL_SPACE_ID : ${SPACE ? "set ✓" : "MISSING ✗"}`);
    console.log(`  CONTENTFUL_CMA_TOKEN: ${CMA_TOKEN ? "set ✓" : "MISSING ✗ (get from Gruve CTO via age)"}`);
    console.log("\n  Paste the CMA token into .env.local, run scripts/migrate-contentful-model.ts once,");
    console.log("  then re-run `pnpm smoke:publish`. (Nothing was sent to Contentful.)");
    process.exit(0);
  }

  console.log(`\x1b[1mPulse → Contentful → Gruve smoke test\x1b[0m  (slug: ${SLUG}, env: ${ENVIRONMENT})`);
  const client = createClient({ accessToken: CMA_TOKEN }, { type: "legacy" });
  const space = await client.getSpace(SPACE);
  const env = await space.getEnvironment(ENVIRONMENT);

  console.log("  1/2 upserting gruveBlog entry (idempotent by pulseId)…");
  const assetId = await findOrCreateAssetId(env);
  const existing = await env.getEntries({
    content_type: CONTENT_TYPE,
    "fields.pulseId": SLUG,
    limit: 1,
  });

  let entry;
  const fields = buildFields(assetId);
  if (existing.items.length > 0) {
    entry = existing.items[0];
    entry.fields = { ...entry.fields, ...fields };
    entry = await entry.update();
    console.log(`      updated entry ${entry.sys.id} (v${entry.sys.version})`);
  } else {
    entry = await env.createEntry(CONTENT_TYPE, { fields });
    console.log(`      created entry ${entry.sys.id} (v${entry.sys.version})`);
  }

  console.log("  2/2 publishing entry…");
  const published = await entry.publish();
  console.log(`      published ${published.sys.id} (v${published.sys.version})`);

  console.log("\n\x1b[32m\x1b[1mDONE.\x1b[0m Verify it renders on Gruve:");
  console.log(`  ${GRUVE_BASE}/blogs/${SLUG}`);
  console.log("\n  404? Confirm Gruve is deployed + the Contentful webhook → /api/revalidate is wired");
  console.log("  (or wait a few seconds for ISR). To remove: unpublish the entry in Contentful.");
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("\x1b[31mpublish-smoke failed:\x1b[0m", msg);
  if (/unknown field|pulseId|pulseMetadata|validation/i.test(msg)) {
    console.error("  → Likely the model migration hasn't run: the pulseId/pulseMetadata fields");
    console.error("    don't exist on gruveBlog yet. Run scripts/migrate-contentful-model.ts first.");
  }
  process.exit(1);
});
