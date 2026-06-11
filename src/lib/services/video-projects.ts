// Video engine read layer (RLS-scoped server client).

import { createClient } from "@/lib/supabase/server";
import type { VideoProject, VideoClip, VideoCharacter } from "@/lib/types/video";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toProject(r: any): VideoProject {
  return {
    id: r.id,
    tenantSlug: r.tenant_slug,
    title: r.title,
    sourceKind: r.source_kind,
    contentPlanId: r.content_plan_id,
    blogPostId: r.blog_post_id,
    briefId: r.brief_id,
    status: r.status,
    version: r.version,
    aspectRatio: r.aspect_ratio,
    targetResolution: r.target_resolution,
    defaultModel: r.default_model,
    generateAudio: r.generate_audio,
    creditEstimate: r.credit_estimate,
    creditActual: r.credit_actual,
    assembledOutputAssetId: r.assembled_output_asset_id,
    generationRunId: r.generation_run_id,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toClip(r: any): VideoClip {
  return {
    id: r.id,
    projectId: r.project_id,
    seq: r.seq,
    mode: r.mode,
    model: r.model,
    prompt: r.prompt,
    negativePrompt: r.negative_prompt,
    durationS: r.duration_s,
    resolution: r.resolution,
    aspectRatio: r.aspect_ratio,
    generateAudio: r.generate_audio,
    characterId: r.character_id,
    sourceVideoAssetId: r.source_video_asset_id,
    startFrameAssetId: r.start_frame_asset_id,
    endFrameAssetId: r.end_frame_asset_id,
    refAudioAssetIds: r.ref_audio_asset_ids ?? [],
    creditEstimate: r.credit_estimate,
    creditActual: r.credit_actual,
    outputAssetId: r.output_asset_id,
    lastFrameAssetId: r.last_frame_asset_id,
    status: r.status,
    lastError: r.last_error,
  };
}

function toCharacter(r: any): VideoCharacter {
  return {
    id: r.id,
    tenantSlug: r.tenant_slug,
    name: r.name,
    description: r.description,
    identityPrompt: r.identity_prompt,
    referenceAssetIds: r.reference_asset_ids ?? [],
    defaultAspectRatio: r.default_aspect_ratio,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listVideoProjects(tenantSlug: string): Promise<VideoProject[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("video_projects")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  return (data ?? []).map(toProject);
}

export async function getVideoProject(
  tenantSlug: string,
  id: string
): Promise<{ project: VideoProject; clips: VideoClip[] } | null> {
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("video_projects")
    .select("*")
    .eq("id", id)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (!p) return null;
  const { data: clips } = await supabase
    .from("video_clips")
    .select("*")
    .eq("project_id", id)
    .order("seq", { ascending: true });
  return { project: toProject(p), clips: (clips ?? []).map(toClip) };
}

export async function listVideoCharacters(tenantSlug: string): Promise<VideoCharacter[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("video_characters")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  return (data ?? []).map(toCharacter);
}

export async function getAssetUrls(
  tenantSlug: string,
  ids: string[]
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("video_assets")
    .select("id, storage_url")
    .eq("tenant_slug", tenantSlug)
    .in("id", ids);
  const out: Record<string, string> = {};
  for (const a of data ?? []) out[a.id as string] = a.storage_url as string;
  return out;
}
