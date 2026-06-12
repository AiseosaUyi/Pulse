"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant, requireUser } from "@/lib/auth";
import { getTenant } from "@/lib/services/tenants";
import {
  storyboardToClips,
  type GeneratedClip,
  type StoryboardSource,
} from "@/lib/ai/video/storyboard-to-clips";
import {
  getPicsartProvider,
  isPicsartConfigured,
} from "@/lib/video/providers/picsart";
import { estimateSeedanceCredits } from "@/lib/video/providers/seedance-constraints";
import { checkVideoBudget, InsufficientCreditsError } from "@/lib/video/budget";
import { BudgetExceededError } from "@/lib/ai/ai-budget";
import { advanceGeneration } from "@/lib/video/video-generation-runner";
import type { ContentPlanOutput } from "@/lib/types/content-engine";
import type { VideoProjectStatus, VideoSourceKind } from "@/lib/types/video";

type Result<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string; reason?: "version_conflict" };

// ── Atomic transition wrapper (clones the seo-approvals pattern) ──────────
async function transition(
  projectId: string,
  from: VideoProjectStatus,
  to: VideoProjectStatus,
  expectedVersion: number,
  reason?: string
): Promise<Result<{ version: number }>> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transition_video_project_status", {
    p_project_id: projectId,
    p_from_status: from,
    p_to_status: to,
    p_expected_version: expectedVersion,
    p_actor: user.id,
    p_reason: reason ?? null,
  });
  if (error) {
    if (error.message.includes("version_conflict")) {
      return {
        success: false,
        error: "This project changed since you opened it — refresh and try again.",
        reason: "version_conflict",
      };
    }
    return { success: false, error: error.message };
  }
  const row = (data as Array<{ new_version: number }> | null)?.[0];
  revalidatePath("/video");
  return { success: true, version: row?.new_version ?? expectedVersion + 1 };
}

// ── Create a project from an approved source + auto-build its storyboard ──
interface CreateInput {
  sourceKind: VideoSourceKind;
  sourceId?: string; // content_plan / blog_post / brief id
  title?: string;
  aspectRatio?: string;
  targetResolution?: string;
  generateAudio?: boolean;
}

export async function createVideoProject(
  input: CreateInput
): Promise<Result<{ projectId: string }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  const t = await getTenant(tenant.slug);
  const supabase = await createClient();

  // Resolve the creative source into a storyboard input.
  let source: StoryboardSource;
  let title = input.title ?? "Untitled video";
  let contentPlanId: string | null = null;
  let blogPostId: string | null = null;
  let briefId: string | null = null;

  if (input.sourceKind === "content_plan" && input.sourceId) {
    const { data } = await supabase
      .from("content_plans")
      .select("output, template_name, status")
      .eq("id", input.sourceId)
      .eq("tenant_slug", tenant.slug)
      .single();
    if (!data) return { success: false, error: "Content plan not found" };
    if (data.status === "dismissed") {
      return { success: false, error: "This content plan was dismissed" };
    }
    // The video project has its own approval gate before any spend, so a
    // reviewed plan in any active status can be promoted here.
    const output = data.output as ContentPlanOutput;
    contentPlanId = input.sourceId;
    title = input.title ?? (data.template_name as string) ?? "Video";
    source = { kind: "scenes", scenes: output.scenes, readyPrompt: output.readyPrompt };
  } else if (input.sourceKind === "blog_post" && input.sourceId) {
    const { data } = await supabase
      .from("blog_posts")
      .select("title, content, status")
      .eq("id", input.sourceId)
      .eq("tenant_slug", tenant.slug)
      .single();
    if (!data) return { success: false, error: "Blog post not found" };
    blogPostId = input.sourceId;
    title = input.title ?? (data.title as string);
    source = { kind: "text", title, body: (data.content as string) ?? "" };
  } else if (input.sourceKind === "brief" && input.sourceId) {
    const { data } = await supabase
      .from("content_briefs")
      .select("title, draft_content")
      .eq("id", input.sourceId)
      .eq("tenant_id", tenant.slug)
      .single();
    if (!data) return { success: false, error: "Brief not found" };
    briefId = input.sourceId;
    title = input.title ?? (data.title as string);
    source = { kind: "text", title, body: (data.draft_content as string) ?? "" };
  } else {
    return { success: false, error: "A source is required to build a storyboard" };
  }

  const aspectRatio = input.aspectRatio ?? "9:16";
  const targetResolution = input.targetResolution ?? "720p";
  const generateAudio = input.generateAudio ?? false;

  let clips: GeneratedClip[];
  try {
    const sb = await storyboardToClips({
      tenantSlug: tenant.slug,
      tenantName: t?.name ?? tenant.slug,
      source,
      aspectRatio,
      targetResolution,
    });
    clips = sb.clips;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Storyboard generation failed",
    };
  }

  const admin = createAdminClient();
  const { data: project, error: pErr } = await admin
    .from("video_projects")
    .insert({
      tenant_slug: tenant.slug,
      title,
      source_kind: input.sourceKind,
      content_plan_id: contentPlanId,
      blog_post_id: blogPostId,
      brief_id: briefId,
      status: "draft",
      aspect_ratio: aspectRatio,
      target_resolution: targetResolution,
      generate_audio: generateAudio,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (pErr || !project) {
    return { success: false, error: pErr?.message ?? "Could not create project" };
  }

  const clipRows = clips.map((c) => ({
    project_id: project.id,
    seq: c.seq,
    mode: c.mode,
    model: c.model,
    prompt: c.prompt,
    duration_s: Math.min(15, Math.max(4, c.duration_s)),
    resolution: c.model.includes("fast") && targetResolution === "1080p" ? "720p" : targetResolution,
    aspect_ratio: aspectRatio,
    generate_audio: generateAudio,
    status: "planned",
  }));
  const { error: cErr } = await admin.from("video_clips").insert(clipRows);
  if (cErr) return { success: false, error: cErr.message };

  revalidatePath("/video");
  return { success: true, projectId: project.id };
}

// Re-run the storyboard (draft only); replaces clips.
export async function regenerateStoryboard(
  projectId: string
): Promise<Result> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  const t = await getTenant(tenant.slug);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("video_projects")
    .select("title, status, aspect_ratio, target_resolution, generate_audio, blog_post_id, brief_id, content_plan_id, source_kind")
    .eq("id", projectId)
    .eq("tenant_slug", tenant.slug)
    .single();
  if (!project) return { success: false, error: "Project not found" };
  if (project.status !== "draft") {
    return { success: false, error: "Only draft projects can be regenerated" };
  }

  // Rebuild source from the original reference.
  let source: StoryboardSource | null = null;
  if (project.content_plan_id) {
    const { data } = await supabase
      .from("content_plans")
      .select("output")
      .eq("id", project.content_plan_id)
      .single();
    if (data) {
      const output = data.output as ContentPlanOutput;
      source = { kind: "scenes", scenes: output.scenes, readyPrompt: output.readyPrompt };
    }
  } else if (project.blog_post_id) {
    const { data } = await supabase
      .from("blog_posts")
      .select("title, content")
      .eq("id", project.blog_post_id)
      .single();
    if (data) source = { kind: "text", title: data.title as string, body: (data.content as string) ?? "" };
  } else if (project.brief_id) {
    const { data } = await supabase
      .from("content_briefs")
      .select("title, draft_content")
      .eq("id", project.brief_id)
      .single();
    if (data) source = { kind: "text", title: data.title as string, body: (data.draft_content as string) ?? "" };
  }
  if (!source) return { success: false, error: "Original source no longer available" };

  let clips: GeneratedClip[];
  try {
    const sb = await storyboardToClips({
      tenantSlug: tenant.slug,
      tenantName: t?.name ?? tenant.slug,
      source,
      aspectRatio: project.aspect_ratio as string,
      targetResolution: project.target_resolution as string,
    });
    clips = sb.clips;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }

  const admin = createAdminClient();
  await admin.from("video_clips").delete().eq("project_id", projectId);
  await admin.from("video_clips").insert(
    clips.map((c) => ({
      project_id: projectId,
      seq: c.seq,
      mode: c.mode,
      model: c.model,
      prompt: c.prompt,
      duration_s: Math.min(15, Math.max(4, c.duration_s)),
      resolution: project.target_resolution as string,
      aspect_ratio: project.aspect_ratio as string,
      generate_audio: project.generate_audio as boolean,
      status: "planned",
    }))
  );
  revalidatePath("/video");
  return { success: true };
}

// ── Lifecycle transitions ─────────────────────────────────────────────────
export async function submitForReview(projectId: string, expectedVersion: number) {
  return transition(projectId, "draft", "in_review", expectedVersion);
}
export async function approveProject(projectId: string, expectedVersion: number) {
  return transition(projectId, "in_review", "approved", expectedVersion, "approved");
}
export async function requestChanges(projectId: string, expectedVersion: number, reason?: string) {
  return transition(projectId, "in_review", "draft", expectedVersion, reason);
}
// Quote every clip, gate on budget + live credits, create the run, then
// transition approved → generating. NO spend before this passes. Kicks the
// first runner tick; the status endpoint / cron drive the rest.
export async function startGeneration(
  projectId: string,
  expectedVersion: number
): Promise<Result<{ estimateCredits: number }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (!isPicsartConfigured()) {
    return { success: false, error: "Video provider not configured (PICSART_API_KEY)" };
  }

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("video_projects")
    .select("id, status, aspect_ratio")
    .eq("id", projectId)
    .eq("tenant_slug", tenant.slug)
    .single();
  if (!project) return { success: false, error: "Project not found" };
  if (project.status !== "approved") {
    return { success: false, error: "Only approved projects can start generation" };
  }

  const { data: clips } = await supabase
    .from("video_clips")
    .select("id, model, duration_s, resolution, aspect_ratio, prompt")
    .eq("project_id", projectId);
  if (!clips || clips.length === 0) {
    return { success: false, error: "Project has no clips" };
  }

  const provider = getPicsartProvider();
  const admin = createAdminClient();
  let estimate = 0;
  for (const c of clips) {
    const params = {
      prompt: c.prompt as string,
      duration: c.duration_s as number,
      resolution: c.resolution as "480p" | "720p" | "1080p",
      aspectRatio: c.aspect_ratio as "9:16",
    };
    let credits: number;
    try {
      credits = (await provider.quote(c.model as string, params)).credits;
    } catch {
      credits = estimateSeedanceCredits(c.model as string, params); // offline fallback
    }
    estimate += credits;
    await admin.from("video_clips").update({ credit_estimate: credits, status: "quoted" }).eq("id", c.id);
  }

  // Budget + live credit gate — throws before any submit.
  try {
    await checkVideoBudget(tenant.slug, estimate, provider);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return { success: false, error: "This would exceed the monthly AI budget. Raise it in Settings → AI Usage." };
    }
    if (err instanceof InsufficientCreditsError) {
      return { success: false, error: `Not enough PicsArt credits (need ${err.needed}, have ${err.balance}). Top up to continue.` };
    }
    return { success: false, error: err instanceof Error ? err.message : "Budget check failed" };
  }

  // Create the durable run + record the estimate.
  const { data: run } = await admin
    .from("video_generation_runs")
    .insert({
      project_id: projectId,
      tenant_slug: tenant.slug,
      status: "running",
      workflow_run_id: `${projectId}:${expectedVersion}`,
      triggered_by: user.id,
    })
    .select("id")
    .single();
  await admin
    .from("video_projects")
    .update({ generation_run_id: run?.id ?? null, credit_estimate: estimate, last_error: null })
    .eq("id", projectId);

  const t = await transition(projectId, "approved", "generating", expectedVersion, "start_generation");
  if (!t.success) return t;

  // Best-effort first tick (non-blocking for the rest).
  try {
    await advanceGeneration(projectId);
  } catch {
    // the status endpoint / cron will drive it
  }
  return { success: true, estimateCredits: estimate };
}

export async function retryGeneration(projectId: string, expectedVersion: number) {
  return transition(projectId, "generation_failed", "generating", expectedVersion, "retry");
}
export async function exportProject(projectId: string, expectedVersion: number) {
  return transition(projectId, "assembled", "exported", expectedVersion);
}
export async function archiveProject(projectId: string, from: VideoProjectStatus, expectedVersion: number) {
  return transition(projectId, from, "archived", expectedVersion);
}
