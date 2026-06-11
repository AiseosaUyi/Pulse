"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant, requireUser } from "@/lib/auth";
import {
  getPicsartProvider,
  isPicsartConfigured,
} from "@/lib/video/providers/picsart";
import { estimateSeedanceCredits } from "@/lib/video/providers/seedance-constraints";
import { checkVideoBudget, InsufficientCreditsError } from "@/lib/video/budget";
import { BudgetExceededError } from "@/lib/ai/ai-budget";
import { advanceGeneration } from "@/lib/video/video-generation-runner";
import { storeVideoAsset, type AssetRole } from "@/lib/video/assets";
import type { ClipMode } from "@/lib/types/video";

type Result<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export interface GenerateInput {
  mode: ClipMode; // identity (prompt) | continuity (frames) | replicate (video)
  prompt: string;
  characterId?: string | null;
  model: string; // seedance-2.0 | seedance-2.0-fast
  durationS: number;
  resolution: string;
  aspectRatio: string;
  generateAudio?: boolean;
  sourceVideoAssetId?: string | null; // replicate
  startFrameAssetId?: string | null; // continuity
  endFrameAssetId?: string | null; // continuity
  sourcePlanId?: string | null; // when prompt came from an approved content plan
}

// Composer fast path: one prompt → one clip → generate now. The click IS the
// authorization (audited), so we skip the multi-step review gate but keep the
// hard budget gate. Multi-clip storyboard projects still use the approval RPC.
export async function createGeneration(
  input: GenerateInput
): Promise<Result<{ projectId: string }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (!input.prompt.trim()) return { success: false, error: "A prompt is required" };
  if (!isPicsartConfigured()) {
    return { success: false, error: "Video provider not configured (PICSART_API_KEY)" };
  }
  if (input.mode === "replicate" && !input.sourceVideoAssetId) {
    return { success: false, error: "Replicate needs a source video" };
  }
  if (input.mode === "continuity" && !input.startFrameAssetId) {
    return { success: false, error: "Image-to-video needs a start frame" };
  }

  const provider = getPicsartProvider();
  const params = {
    prompt: input.prompt,
    duration: input.durationS,
    resolution: input.resolution as "480p" | "720p" | "1080p",
    aspectRatio: input.aspectRatio as "9:16",
  };
  let credits: number;
  try {
    credits = (await provider.quote(input.model, params)).credits;
  } catch {
    credits = estimateSeedanceCredits(input.model, params);
  }

  try {
    await checkVideoBudget(tenant.slug, credits, provider);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return { success: false, error: "This would exceed the monthly AI budget. Raise it in Settings → AI Usage." };
    }
    if (err instanceof InsufficientCreditsError) {
      return { success: false, error: `Not enough PicsArt credits (need ${err.needed}, have ${err.balance}). Top up to continue.` };
    }
    return { success: false, error: err instanceof Error ? err.message : "Budget check failed" };
  }

  const admin = createAdminClient();
  const title = input.prompt.trim().slice(0, 80) || "Generation";
  const { data: project, error: pErr } = await admin
    .from("video_projects")
    .insert({
      tenant_slug: tenant.slug,
      title,
      source_kind: input.sourcePlanId ? "content_plan" : "manual",
      content_plan_id: input.sourcePlanId ?? null,
      status: "generating",
      version: 1,
      aspect_ratio: input.aspectRatio,
      target_resolution: input.resolution,
      default_model: input.model,
      generate_audio: input.generateAudio ?? false,
      credit_estimate: credits,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (pErr || !project) return { success: false, error: pErr?.message ?? "Could not create generation" };

  const { error: cErr } = await admin.from("video_clips").insert({
    project_id: project.id,
    seq: 1,
    mode: input.mode,
    model: input.model,
    prompt: input.prompt,
    duration_s: input.durationS,
    resolution: input.resolution,
    aspect_ratio: input.aspectRatio,
    generate_audio: input.generateAudio ?? false,
    character_id: input.characterId ?? null,
    source_video_asset_id: input.sourceVideoAssetId ?? null,
    start_frame_asset_id: input.startFrameAssetId ?? null,
    end_frame_asset_id: input.endFrameAssetId ?? null,
    credit_estimate: credits,
    status: "quoted",
  });
  if (cErr) return { success: false, error: cErr.message };

  const { data: run } = await admin
    .from("video_generation_runs")
    .insert({
      project_id: project.id,
      tenant_slug: tenant.slug,
      status: "running",
      workflow_run_id: `${project.id}:1`,
      triggered_by: user.id,
    })
    .select("id")
    .single();
  await admin.from("video_projects").update({ generation_run_id: run?.id ?? null }).eq("id", project.id);

  // Audit the click as the authorization.
  await admin.from("video_project_status_audit").insert({
    project_id: project.id,
    from_status: "draft",
    to_status: "generating",
    actor: user.id,
    reason: "composer generate",
  });

  try {
    await advanceGeneration(project.id);
  } catch {
    // status endpoint / cron will drive it
  }

  revalidatePath("/video");
  return { success: true, projectId: project.id };
}

// Upload a reference video, start/end frame, or source video for the composer.
export async function uploadVideoAsset(
  role: AssetRole,
  formData: FormData
): Promise<Result<{ assetId: string; url: string }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "No file provided" };

  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  if (!isVideo && !isImage) return { success: false, error: "Upload an image or video" };
  const kind = isVideo ? ("video" as const) : ("image" as const);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await storeVideoAsset({
    tenantSlug: tenant.slug,
    bytes,
    mime: file.type,
    kind,
    role,
    createdBy: user.id,
  });
  return { success: true, assetId: stored.id, url: stored.storageUrl };
}
