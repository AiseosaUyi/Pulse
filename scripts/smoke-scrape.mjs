// Local smoke test for the scrape pipeline. Runs ONE hashtag on each
// platform and prints the parsed output + cost signals.
//
// Run: node --env-file=.env.local scripts/smoke-scrape.mjs

import { ApifyClient } from "apify-client";

const token = process.env.APIFY_API_TOKEN;
const tiktokActor = process.env.APIFY_TIKTOK_ACTOR_ID;
const igActor = process.env.APIFY_INSTAGRAM_ACTOR_ID;

if (!token) {
  console.error("APIFY_API_TOKEN missing");
  process.exit(1);
}

const client = new ApifyClient({ token });

async function runTikTok() {
  if (!tiktokActor) {
    console.log("APIFY_TIKTOK_ACTOR_ID missing — skipping TikTok");
    return;
  }
  console.log(`\n--- TikTok (${tiktokActor}) ---`);
  const started = Date.now();
  try {
    const run = await client.actor(tiktokActor).call(
      {
        hashtags: ["lagosnightlife"],
        resultsPerPage: 3,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
      },
      { timeout: 180, memory: 1024 }
    );
    console.log(`  run status: ${run.status} (${Date.now() - started}ms)`);
    console.log(`  dataset id: ${run.defaultDatasetId}`);
    if (!run.defaultDatasetId) return;
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 3 });
    console.log(`  items returned: ${items.length}`);
    for (const item of items.slice(0, 1)) {
      console.log("  sample keys:", Object.keys(item).slice(0, 15));
      console.log("  full item:", JSON.stringify(item, null, 2).slice(0, 800));
    }
  } catch (err) {
    console.error("  FAILED:", err.message ?? err);
    console.error("  statusCode:", err.statusCode);
    console.error("  type:", err.type);
  }
}

async function runInstagram() {
  if (!igActor) {
    console.log("APIFY_INSTAGRAM_ACTOR_ID missing — skipping IG");
    return;
  }
  console.log(`\n--- Instagram (${igActor}) ---`);
  const started = Date.now();
  try {
    const run = await client.actor(igActor).call(
      {
        directUrls: ["https://www.instagram.com/explore/tags/lagosevents/"],
        resultsType: "posts",
        resultsLimit: 3,
      },
      { timeout: 180, memory: 1024 }
    );
    console.log(`  run status: ${run.status} (${Date.now() - started}ms)`);
    console.log(`  dataset id: ${run.defaultDatasetId}`);
    if (!run.defaultDatasetId) return;
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 3 });
    console.log(`  items returned: ${items.length}`);
    for (const item of items.slice(0, 1)) {
      console.log("  sample keys:", Object.keys(item).slice(0, 15));
    }
  } catch (err) {
    console.error("  FAILED:", err.message ?? err);
    console.error("  statusCode:", err.statusCode);
    console.error("  type:", err.type);
  }
}

await runTikTok();
await runInstagram();
console.log("\ndone");
