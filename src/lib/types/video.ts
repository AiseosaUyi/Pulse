// Video generation engine types (rows in migrations 060-061).

export type VideoProjectStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "generating"
  | "assembled"
  | "exported"
  | "generation_failed"
  | "archived";

export type ClipMode = "identity" | "continuity" | "replicate";
export type ClipStatus = "planned" | "quoted" | "generating" | "ready" | "failed";
export type VideoSourceKind = "content_plan" | "blog_post" | "brief" | "manual";

export interface VideoCharacter {
  id: string;
  tenantSlug: string;
  name: string;
  description: string | null;
  identityPrompt: string | null;
  referenceAssetIds: string[];
  defaultAspectRatio: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface VideoAsset {
  id: string;
  tenantSlug: string;
  kind: "image" | "video" | "audio";
  role:
    | "character_ref"
    | "source_video"
    | "ref_audio"
    | "start_frame"
    | "end_frame"
    | "clip_output"
    | "last_frame";
  storageUrl: string;
  picsartUid: string | null;
  contentHash: string | null;
  width: number | null;
  height: number | null;
  durationS: number | null;
  createdAt: string;
}

export interface VideoProject {
  id: string;
  tenantSlug: string;
  title: string;
  sourceKind: VideoSourceKind;
  contentPlanId: string | null;
  blogPostId: string | null;
  briefId: string | null;
  status: VideoProjectStatus;
  version: number;
  aspectRatio: string;
  targetResolution: string;
  defaultModel: string;
  generateAudio: boolean;
  creditEstimate: number | null;
  creditActual: number | null;
  assembledOutputAssetId: string | null;
  generationRunId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoClip {
  id: string;
  projectId: string;
  seq: number;
  mode: ClipMode;
  model: string;
  prompt: string;
  negativePrompt: string | null;
  durationS: number;
  resolution: string;
  aspectRatio: string;
  generateAudio: boolean;
  characterId: string | null;
  sourceVideoAssetId: string | null;
  startFrameAssetId: string | null;
  endFrameAssetId: string | null;
  refAudioAssetIds: string[];
  creditEstimate: number | null;
  creditActual: number | null;
  outputAssetId: string | null;
  lastFrameAssetId: string | null;
  status: ClipStatus;
  lastError: string | null;
}
