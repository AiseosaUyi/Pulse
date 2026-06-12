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

export interface GenerationSummary {
  id: string;
  title: string;
  status: string;
  mode: string | null;
  prompt: string | null;
  aspectRatio: string;
  resolution: string;
  durationS: number | null;
  outputUrl: string | null;
  creditEstimate: number | null;
  createdAt: string;
}

// History feed: recent generations with their playable output (assembled, or
// the single clip's output for composer generations).
export async function listGenerations(
  tenantSlug: string,
  limit = 40
): Promise<GenerationSummary[]> {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("video_projects")
    .select(
      "id, title, status, aspect_ratio, target_resolution, credit_estimate, assembled_output_asset_id, created_at"
    )
    .eq("tenant_slug", tenantSlug)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (projects ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const ids = rows.map((p) => p.id as string);
  const { data: clipRows } = await supabase
    .from("video_clips")
    .select("project_id, seq, mode, prompt, duration_s, output_asset_id")
    .in("project_id", ids)
    .order("seq", { ascending: true });
  const firstClip = new Map<string, Record<string, unknown>>();
  for (const c of (clipRows ?? []) as Array<Record<string, unknown>>) {
    const pid = c.project_id as string;
    if (!firstClip.has(pid)) firstClip.set(pid, c);
  }

  const assetIds = [
    ...rows.map((p) => p.assembled_output_asset_id as string | null),
    ...[...firstClip.values()].map((c) => c.output_asset_id as string | null),
  ].filter(Boolean) as string[];
  const urls = await getAssetUrls(tenantSlug, assetIds);

  return rows.map((p) => {
    const c = firstClip.get(p.id as string);
    const outAsset =
      (p.assembled_output_asset_id as string | null) ??
      (c?.output_asset_id as string | null) ??
      null;
    return {
      id: p.id as string,
      title: p.title as string,
      status: p.status as string,
      mode: (c?.mode as string) ?? null,
      prompt: (c?.prompt as string) ?? null,
      aspectRatio: p.aspect_ratio as string,
      resolution: p.target_resolution as string,
      durationS: (c?.duration_s as number) ?? null,
      outputUrl: outAsset ? urls[outAsset] ?? null : null,
      creditEstimate: (p.credit_estimate as number) ?? null,
      createdAt: p.created_at as string,
    };
  });
}

export interface ApprovedContentOption {
  id: string;
  label: string;
  prompt: string;
}

// Approved content plans the composer can drop into the prompt.
export async function listApprovedContentForVideo(
  tenantSlug: string
): Promise<ApprovedContentOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("content_plans")
    .select("id, template_name, output, status, created_at")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["approved", "used"])
    .order("created_at", { ascending: false })
    .limit(30);
  return ((data ?? []) as Array<Record<string, unknown>>).map((p) => {
    const output = (p.output as { hook?: string; readyPrompt?: string }) ?? {};
    return {
      id: p.id as string,
      label: `${(p.template_name as string) ?? "Plan"} — ${output.hook ?? ""}`.slice(0, 80),
      prompt: output.readyPrompt || output.hook || "",
    };
  });
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
