// Durable, resumable video generation runner. Unlike the SEO publish runner
// (which runs straight through fast Contentful ops), clips take 1-2 min, so
// this ADVANCES and YIELDS: each call submits/polls as far as it can without
// blocking, then returns. Durable state lives in video_clips + video_render_jobs
// rows (the checkpoint), with coarse phases recorded in video_generation_run_steps.
// Re-invoked by the status endpoint (client poll) and the video-maintenance cron
// until the project is assembled. Resumes for free — finished clips are skipped.

import { createAdminClient } from "@/lib/supabase/admin";
import { logAiCall } from "@/lib/ai/gateway";
import {
  getPicsartProvider,
  isPicsartConfigured,
  picsartCreditUsd,
} from "@/lib/video/providers/picsart";
import { getSeedanceModel } from "@/lib/video/providers/seedance-constraints";
import { fetchAndStoreVideoAsset } from "@/lib/video/assets";
import type {
  SeedanceGenerateParams,
  VideoProvider,
} from "@/lib/video/providers/types";

type Admin = ReturnType<typeof createAdminClient>;

export interface AdvanceResult {
  projectId: string;
  status: string;
  clipsReady: number;
  clipsTotal: number;
  done: boolean;
  pending: boolean; // true when waiting on provider jobs (poll again later)
  error?: string;
}

interface ClipRow {
  id: string;
  seq: number;
  mode: "identity" | "continuity" | "replicate";
  model: string;
  prompt: string;
  duration_s: number;
  resolution: string;
  aspect_ratio: string;
  generate_audio: boolean;
  character_id: string | null;
  source_video_asset_id: string | null;
  start_frame_asset_id: string | null;
  status: string;
  credit_estimate: number | null;
  output_asset_id: string | null;
  last_frame_asset_id: string | null;
}

async function assetUrl(admin: Admin, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await admin.from("video_assets").select("storage_url").eq("id", id).maybeSingle();
  return (data?.storage_url as string) ?? null;
}

async function characterRefUrls(
  admin: Admin,
  characterId: string | null
): Promise<{ urls: string[]; identityPrompt: string | null }> {
  if (!characterId) return { urls: [], identityPrompt: null };
  const { data: ch } = await admin
    .from("video_characters")
    .select("reference_asset_ids, identity_prompt")
    .eq("id", characterId)
    .maybeSingle();
  const ids = (ch?.reference_asset_ids as string[] | null) ?? [];
  if (ids.length === 0) return { urls: [], identityPrompt: (ch?.identity_prompt as string) ?? null };
  const { data: assets } = await admin
    .from("video_assets")
    .select("id, storage_url")
    .in("id", ids);
  const urls = (assets ?? []).map((a) => a.storage_url as string).slice(0, 9);
  return { urls, identityPrompt: (ch?.identity_prompt as string) ?? null };
}

// Build Seedance params + resolved model id for a clip in its mode.
async function buildClipParams(
  admin: Admin,
  clip: ClipRow,
  nextIsContinuity: boolean
): Promise<{ modelId: string; params: SeedanceGenerateParams }> {
  const { urls, identityPrompt } = await characterRefUrls(admin, clip.character_id);
  const prompt = identityPrompt ? `${clip.prompt}\n${identityPrompt}` : clip.prompt;
  const base: SeedanceGenerateParams = {
    prompt,
    aspectRatio: clip.aspect_ratio as SeedanceGenerateParams["aspectRatio"],
    resolution: clip.resolution as SeedanceGenerateParams["resolution"],
    duration: clip.duration_s,
    generateAudio: clip.generate_audio,
    returnLastFrame: nextIsContinuity,
  };

  if (clip.mode === "replicate") {
    const srcUrl = await assetUrl(admin, clip.source_video_asset_id);
    return {
      modelId: clip.model.includes("fast") ? "seedance-2.0-fast-video-edit" : "seedance-2.0-video-edit",
      params: { ...base, returnLastFrame: false, videoUrl: srcUrl ?? undefined, imageUrls: urls.length ? urls : undefined },
    };
  }
  if (clip.mode === "continuity") {
    const startUrl = await assetUrl(admin, clip.start_frame_asset_id);
    // Continuity: frames are exclusive with references.
    return { modelId: clip.model, params: { ...base, startFrame: startUrl ?? undefined } };
  }
  // identity
  return { modelId: clip.model, params: { ...base, imageUrls: urls.length ? urls : undefined } };
}

async function recordStep(
  admin: Admin,
  runId: string,
  step: string,
  status: "ok" | "failed",
  payload?: unknown,
  error?: string
) {
  // attempt = count of existing rows for this step + 1
  const { count } = await admin
    .from("video_generation_run_steps")
    .select("*", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("step", step);
  await admin.from("video_generation_run_steps").insert({
    run_id: runId,
    step,
    attempt: (count ?? 0) + 1,
    status,
    payload: payload ?? null,
    error: error ? { message: error } : null,
  });
}

/**
 * Advance one project's generation as far as possible without blocking, then
 * return. Idempotent + resumable: safe to call repeatedly.
 */
export async function advanceGeneration(projectId: string): Promise<AdvanceResult> {
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("video_projects")
    .select("id, tenant_slug, status, version, generation_run_id, generate_audio")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return base(projectId, "not_found", 0, 0, true, false, "Project not found");
  if (project.status !== "generating") {
    return base(projectId, project.status as string, 0, 0, true, false);
  }
  if (!isPicsartConfigured()) {
    return base(projectId, "generating", 0, 0, false, false, "Video provider not configured (PICSART_API_KEY)");
  }
  const provider = getPicsartProvider();
  const runId = project.generation_run_id as string | null;

  const { data: clipRows } = await admin
    .from("video_clips")
    .select("id, seq, mode, model, prompt, duration_s, resolution, aspect_ratio, generate_audio, character_id, source_video_asset_id, start_frame_asset_id, status, credit_estimate, output_asset_id, last_frame_asset_id")
    .eq("project_id", projectId)
    .order("seq", { ascending: true });
  const clips = (clipRows ?? []) as ClipRow[];
  const total = clips.length;

  let pending = false;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (clip.status === "ready") continue;
    if (clip.status === "failed") continue;

    const nextIsContinuity = clips[i + 1]?.mode === "continuity";

    // Find an open render job for this clip.
    const { data: job } = await admin
      .from("video_render_jobs")
      .select("id, provider_job_id, status, attempts")
      .eq("clip_id", clip.id)
      .in("status", ["submitted", "polling"])
      .order("submitted_at", { ascending: false })
      .maybeSingle();

    if (!job) {
      // Submit. (Continuity clips depend on the previous clip's last frame —
      // if it isn't ready yet, yield and come back.)
      if (clip.mode === "continuity" && !clip.start_frame_asset_id) {
        const prev = clips[i - 1];
        if (prev?.last_frame_asset_id) {
          await admin.from("video_clips").update({ start_frame_asset_id: prev.last_frame_asset_id }).eq("id", clip.id);
          clip.start_frame_asset_id = prev.last_frame_asset_id;
        } else {
          pending = true;
          break; // wait for the prior clip to produce its last frame
        }
      }
      const { modelId, params } = await buildClipParams(admin, clip, nextIsContinuity);
      try {
        const { jobId } = await provider.generate(modelId, params);
        await admin.from("video_render_jobs").insert({
          clip_id: clip.id,
          tenant_slug: project.tenant_slug,
          provider: "picsart",
          provider_job_id: jobId,
          status: "polling",
          attempts: 1,
        });
        await admin.from("video_clips").update({ status: "generating" }).eq("id", clip.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await admin.from("video_clips").update({ status: "failed", last_error: msg }).eq("id", clip.id);
        await logMedia(project.tenant_slug, modelId, 0, false, msg);
      }
      pending = true;
      break; // one submit per tick keeps each call short
    }

    // Poll the open job once.
    const poll = await provider.poll(job.provider_job_id as string);
    await admin
      .from("video_render_jobs")
      .update({ status: poll.status === "succeeded" ? "succeeded" : poll.status === "failed" ? "failed" : "polling", attempts: (job.attempts as number) + 1, last_polled_at: new Date().toISOString(), result_url: poll.resultUrl ?? null, error: poll.error ?? null })
      .eq("id", job.id);

    if (poll.status === "succeeded" && poll.resultUrl) {
      const stored = await fetchAndStoreVideoAsset(poll.resultUrl, {
        tenantSlug: project.tenant_slug,
        mime: "video/mp4",
        kind: "video",
        role: "clip_output",
      });
      let lastFrameId: string | null = null;
      if (poll.lastFrameUrl) {
        const lf = await fetchAndStoreVideoAsset(poll.lastFrameUrl, {
          tenantSlug: project.tenant_slug,
          mime: "image/jpeg",
          kind: "image",
          role: "last_frame",
        });
        lastFrameId = lf.id;
      }
      const credits = clip.credit_estimate ?? 0;
      await admin.from("video_clips").update({ status: "ready", output_asset_id: stored.id, last_frame_asset_id: lastFrameId, credit_actual: credits }).eq("id", clip.id);
      await logMedia(project.tenant_slug, clip.model, credits, true);
    } else if (poll.status === "failed") {
      await admin.from("video_clips").update({ status: "failed", last_error: poll.error ?? "generation failed" }).eq("id", clip.id);
      await logMedia(project.tenant_slug, clip.model, 0, false, poll.error);
    } else {
      pending = true; // still running
    }
    break; // one provider op per tick
  }

  // Re-read clip statuses.
  const { data: fresh } = await admin.from("video_clips").select("status, credit_actual").eq("project_id", projectId);
  const statuses = (fresh ?? []).map((c) => c.status as string);
  const ready = statuses.filter((s) => s === "ready").length;
  const failed = statuses.filter((s) => s === "failed").length;

  if (failed > 0 && ready + failed === total) {
    if (runId) await recordStep(admin, runId, "clips", "failed", null, `${failed} clip(s) failed`);
    await finishRun(admin, runId, "failed", `${failed} clip(s) failed`);
    await transitionRunner(admin, projectId, "generating", "generation_failed", project.version as number, `${failed} clip(s) failed`);
    return base(projectId, "generation_failed", ready, total, false, false, `${failed} clip(s) failed`);
  }

  if (ready === total && total > 0) {
    // Assemble via video-extend (≤3 clips per join, chained).
    try {
      const assembledId = await assemble(admin, provider, projectId, project.tenant_slug);
      const actual = (fresh ?? []).reduce((s, c) => s + (Number(c.credit_actual) || 0), 0);
      await admin.from("video_projects").update({ assembled_output_asset_id: assembledId, credit_actual: actual }).eq("id", projectId);
      if (runId) await recordStep(admin, runId, "assemble", "ok", { assembledId });
      await finishRun(admin, runId, "succeeded");
      await transitionRunner(admin, projectId, "generating", "assembled", project.version as number, "assembled");
      return base(projectId, "assembled", ready, total, true, false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (runId) await recordStep(admin, runId, "assemble", "failed", null, msg);
      await finishRun(admin, runId, "failed", msg);
      await transitionRunner(admin, projectId, "generating", "generation_failed", project.version as number, msg);
      return base(projectId, "generation_failed", ready, total, false, false, msg);
    }
  }

  return base(projectId, "generating", ready, total, false, pending);
}

// Join ready clips into one output. ≤3 per video-extend call, chained.
async function assemble(
  admin: Admin,
  provider: VideoProvider,
  projectId: string,
  tenantSlug: string
): Promise<string> {
  const { data: clips } = await admin
    .from("video_clips")
    .select("seq, output_asset_id, resolution, aspect_ratio, duration_s")
    .eq("project_id", projectId)
    .order("seq", { ascending: true });
  const ordered = (clips ?? []).filter((c) => c.output_asset_id);
  const urls: string[] = [];
  for (const c of ordered) {
    const u = await assetUrl(admin, c.output_asset_id as string);
    if (u) urls.push(u);
  }
  if (urls.length === 0) throw new Error("no clip outputs to assemble");
  if (urls.length === 1) {
    // Single clip — the assembled output IS that clip.
    const single = await fetchAndStoreVideoAsset(urls[0], { tenantSlug, mime: "video/mp4", kind: "video", role: "clip_output" });
    return single.id;
  }

  const aspect = (ordered[0]?.aspect_ratio as SeedanceGenerateParams["aspectRatio"]) ?? "9:16";
  const resolution = (ordered[0]?.resolution as SeedanceGenerateParams["resolution"]) ?? "720p";

  // Chain joins of up to 3.
  let current = urls;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 3) {
      const group = current.slice(i, i + 3);
      if (group.length === 1) {
        next.push(group[0]);
        continue;
      }
      const { jobId } = await provider.generate("seedance-2.0-video-extend", {
        videoUrls: group,
        aspectRatio: aspect,
        resolution,
        duration: 15,
      });
      const url = await pollToCompletion(provider, jobId);
      next.push(url);
    }
    current = next;
  }
  const stored = await fetchAndStoreVideoAsset(current[0], { tenantSlug, mime: "video/mp4", kind: "video", role: "clip_output" });
  return stored.id;
}

// Bounded poll loop for the assemble joins (these run inside one tick).
async function pollToCompletion(provider: VideoProvider, jobId: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const p = await provider.poll(jobId);
    if (p.status === "succeeded" && p.resultUrl) return p.resultUrl;
    if (p.status === "failed") throw new Error(p.error ?? "assemble join failed");
    await sleep(3000);
  }
  throw new Error("assemble join timed out");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function finishRun(admin: Admin, runId: string | null, status: "succeeded" | "failed", error?: string) {
  if (!runId) return;
  await admin.from("video_generation_runs").update({ status, finished_at: new Date().toISOString(), error: error ? { message: error } : null }).eq("id", runId);
}

async function transitionRunner(
  admin: Admin,
  projectId: string,
  from: string,
  to: string,
  expectedVersion: number,
  reason: string
) {
  // Runner-driven transition (system actor). The runner runs as the SERVICE ROLE
  // (cron / status endpoint), where auth.uid() is null — so it CANNOT go through
  // transition_video_project_status(): that RPC gates on is_tenant_member(auth.uid())
  // and always raises 'forbidden' for the service role, which would leave the
  // project stuck in `generating` forever (no success → assembled, no failure →
  // generation_failed). The admin client legitimately bypasses RLS for system work,
  // so we apply the same optimistic-version update + audit insert directly here.
  // Best-effort; version may have advanced if a human acted concurrently — re-read
  // and retry once against the current version.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin
      .from("video_projects")
      .update({ status: to, version: expectedVersion + 1 })
      .eq("id", projectId)
      .eq("status", from)
      .eq("version", expectedVersion)
      .select("id")
      .maybeSingle();
    if (!error && data) {
      await admin.from("video_project_status_audit").insert({
        project_id: projectId,
        from_status: from,
        to_status: to,
        actor: null,
        reason,
      });
      return;
    }
    // No row updated: either a version race or the project already moved on.
    const { data: cur } = await admin
      .from("video_projects")
      .select("status, version")
      .eq("id", projectId)
      .maybeSingle();
    if (cur?.status !== from) return; // already transitioned elsewhere — nothing to do
    expectedVersion = cur.version as number;
  }
}

function logMedia(
  tenantSlug: string,
  model: string,
  credits: number,
  success: boolean,
  errorMessage?: string
) {
  const seedance = getSeedanceModel(model);
  return logAiCall({
    tenantSlug,
    purpose: "video-generate",
    feature: "seedance_clip",
    model: seedance ? `picsart/${model}` : model,
    credits,
    costUsd: credits * picsartCreditUsd(),
    success,
    errorMessage,
  });
}

function base(
  projectId: string,
  status: string,
  clipsReady: number,
  clipsTotal: number,
  done: boolean,
  pending: boolean,
  error?: string
): AdvanceResult {
  return { projectId, status, clipsReady, clipsTotal, done, pending, error };
}
