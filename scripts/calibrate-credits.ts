/**
 * One-shot credit calibration: read balance → generate ONE minimal clip →
 * read balance. The delta is PicsArt's REAL billed cost (they expose no
 * per-job cost / history endpoint, so balance-before/after is the only way).
 *
 * Run: npx tsx --env-file=.env.local scripts/calibrate-credits.ts [model] [seconds] [res]
 * Default: seedance-2.0 1s 480p (cheapest measurement of the priciest model).
 */
import { getPicsartProvider, isPicsartConfigured } from "@/lib/video/providers/picsart";
import { estimateSeedanceCredits } from "@/lib/video/providers/seedance-constraints";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!isPicsartConfigured()) throw new Error("PICSART_API_KEY not set");
  const provider = getPicsartProvider();
  const model = process.argv[2] || "seedance-2.0";
  const seconds = Number(process.argv[3] || 1);
  const resolution = (process.argv[4] || "480p") as "480p" | "720p" | "1080p";
  const params = { prompt: "calibration test clip, simple abstract motion", duration: seconds, resolution, aspectRatio: "9:16" as const };

  const before = (await provider.creditBalance()).balance;
  const ourEstimate = estimateSeedanceCredits(model, params);
  console.log(`[cal] balance before: ${before} cr`);
  console.log(`[cal] generating: ${model} ${seconds}s ${resolution}  (our app would estimate ${ourEstimate} cr)`);

  let jobId: string;
  try {
    ({ jobId } = await provider.generate(model, params));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`\n[cal] SUBMIT REJECTED: ${msg}`);
    console.log(`[cal] => a ${seconds}s ${resolution} ${model} clip costs MORE than the ${before} cr available (no charge made).`);
    return;
  }
  console.log(`[cal] job=${jobId} — polling…`);

  const deadline = Date.now() + 5 * 60_000;
  let url: string | undefined;
  while (Date.now() < deadline) {
    const p = await provider.poll(jobId);
    if (p.status === "succeeded") { url = p.resultUrl; break; }
    if (p.status === "failed") { console.log(`[cal] generation FAILED at provider: ${p.error}`); break; }
    await sleep(5000);
  }

  // Balance may settle a beat after completion — sample twice.
  await sleep(3000);
  const after = (await provider.creditBalance()).balance;
  const delta = before - after;
  console.log(`\n========== CALIBRATION RESULT ==========`);
  console.log(`model=${model}  duration=${seconds}s  res=${resolution}`);
  console.log(`balance: ${before} -> ${after}   REAL COST = ${delta} cr`);
  console.log(`our app estimate was: ${ourEstimate} cr  (off by ${ourEstimate ? (delta / ourEstimate).toFixed(1) : "∞"}x)`);
  if (delta > 0) console.log(`implied rate ≈ ${(delta / seconds).toFixed(1)} cr/sec (1s includes any fixed base cost, so longer clips are ≤ this/sec)`);
  console.log(`result url: ${url ?? "(none)"}`);
  console.log(`========================================`);
}

main().catch((e) => { console.error("[cal] fatal:", e instanceof Error ? e.message : e); process.exit(1); });
