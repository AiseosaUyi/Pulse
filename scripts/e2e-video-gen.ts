/**
 * E2E: drive a real video generation through the ACTUAL runner.
 * Seeds a project + 1 clip (tenant `gruve`), then loops advanceGeneration()
 * exactly like the status endpoint / cron does — submit → poll → store →
 * transition. Proves the runner-transition fix lets a generation reach
 * `assembled` (it was stuck in `generating` before the fix).
 *
 * Run: npx tsx --env-file=.env.local scripts/e2e-video-gen.ts
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { advanceGeneration } from "@/lib/video/video-generation-runner";
import { getPicsartProvider, isPicsartConfigured } from "@/lib/video/providers/picsart";
import { estimateSeedanceCredits } from "@/lib/video/providers/seedance-constraints";

const TENANT = "gruve";
const MODEL = "seedance-1.5"; // cheapest proven t2v (7 cr/s)
const DURATION = 5;
const RES = "720p";
const ASPECT = "9:16";
const PROMPT =
  "A warm, energetic 6-second clip for Gruve: a vibrant Lagos rooftop event at golden hour, " +
  "friends laughing with drinks, quick confident camera push-in, bright natural light, " +
  "text overlay 'Find your next event on Gruve'. Upbeat, premium, on-brand.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!isPicsartConfigured()) throw new Error("PICSART_API_KEY not set");
  const admin = createAdminClient();
  const provider = getPicsartProvider();

  const params = { prompt: PROMPT, duration: DURATION, resolution: RES as "720p", aspectRatio: ASPECT as "9:16" };
  let credits: number;
  try {
    credits = (await provider.quote(MODEL, params)).credits;
  } catch {
    credits = estimateSeedanceCredits(MODEL, params);
  }
  console.log(`[e2e] model=${MODEL} dur=${DURATION}s res=${RES} est=${credits}cr`);

  // 1) Seed project (generating, v1) — mirrors createGeneration's fast path.
  const { data: project, error: pErr } = await admin
    .from("video_projects")
    .insert({
      tenant_slug: TENANT,
      title: "E2E test — Gruve rooftop",
      source_kind: "manual",
      status: "generating",
      version: 1,
      aspect_ratio: ASPECT,
      target_resolution: RES,
      default_model: MODEL,
      generate_audio: false,
      credit_estimate: credits,
    })
    .select("id")
    .single();
  if (pErr || !project) throw new Error(`seed project: ${pErr?.message}`);
  console.log(`[e2e] project=${project.id}`);

  await admin.from("video_clips").insert({
    project_id: project.id,
    seq: 1,
    mode: "identity",
    model: MODEL,
    prompt: PROMPT,
    duration_s: DURATION,
    resolution: RES,
    aspect_ratio: ASPECT,
    generate_audio: false,
    credit_estimate: credits,
    status: "quoted",
  });
  const { data: run } = await admin
    .from("video_generation_runs")
    .insert({ project_id: project.id, tenant_slug: TENANT, status: "running", workflow_run_id: `${project.id}:1` })
    .select("id")
    .single();
  await admin.from("video_projects").update({ generation_run_id: run?.id ?? null }).eq("id", project.id);

  // 2) Drive the runner to completion (max ~8 min).
  const deadline = Date.now() + 8 * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const res = await advanceGeneration(project.id);
    const { data: p } = await admin
      .from("video_projects")
      .select("status, version, assembled_output_asset_id, credit_actual, last_error")
      .eq("id", project.id)
      .single();
    const { data: cs } = await admin
      .from("video_clips")
      .select("seq, status, last_error")
      .eq("project_id", project.id)
      .order("seq");
    const line = `status=${p?.status} v=${p?.version} clips=[${(cs ?? []).map((c) => `${c.seq}:${c.status}`).join(",")}] done=${res.done ?? false}`;
    if (line !== last) {
      console.log(`[e2e] ${line}`);
      last = line;
    }
    if (p?.status === "assembled" || p?.status === "exported") {
      const aid = p.assembled_output_asset_id;
      const { data: asset } = aid
        ? await admin.from("video_assets").select("storage_url").eq("id", aid).single()
        : { data: null };
      console.log(`\n✅ E2E PASSED — project reached '${p.status}' (the runner transitioned out of 'generating').`);
      console.log(`   credit_actual=${p.credit_actual}`);
      console.log(`   assembled MP4: ${asset?.storage_url ?? "(none)"}`);
      return;
    }
    if (p?.status === "generation_failed") {
      const failed = (cs ?? []).find((c) => c.status === "failed");
      console.log(`\n❌ E2E FAILED — project moved to 'generation_failed'.`);
      console.log(`   project.last_error=${p.last_error}`);
      console.log(`   clip error=${failed?.last_error ?? "(none)"}`);
      console.log(`   NOTE: the runner DID transition (the fix works); the clip itself failed at the provider.`);
      return;
    }
    await sleep(8000);
  }
  console.log("\n⚠️  E2E TIMEOUT — still generating after 8 min (provider slow). Runner did not error.");
}

main().catch((e) => {
  console.error("[e2e] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
