// Seedance 2.0 model catalog, constraint rules, and an offline credit
// estimator. Pure (no I/O) so it's unit-testable and reusable by the UI for
// instant client-side validation. The provider's quote() is the ONLY price
// truth at runtime; the estimate here is for UI previews + tests only.

import type { SeedanceGenerateParams, VideoMode } from "./types";

export interface SeedanceModel {
  id: string;
  mode: VideoMode;
  label: string;
  fast: boolean;
  maxResolution: "720p" | "1080p";
  creditsPerSecond: number; // 720p baseline; 1080p uses a multiplier
}

// §4.1 + §4.3 (verified live; runtime truth is quote()).
export const SEEDANCE_MODELS: SeedanceModel[] = [
  { id: "seedance-2.0", mode: "t2v", label: "Seedance 2.0 (Pro)", fast: false, maxResolution: "1080p", creditsPerSecond: 10 },
  { id: "seedance-2.0-fast", mode: "t2v", label: "Seedance 2.0 Fast", fast: true, maxResolution: "720p", creditsPerSecond: 8 },
  { id: "seedance-2.0-video-edit", mode: "v2v", label: "Seedance 2.0 Video Edit (replicate)", fast: false, maxResolution: "1080p", creditsPerSecond: 10 },
  { id: "seedance-2.0-fast-video-edit", mode: "v2v", label: "Seedance 2.0 Fast Video Edit", fast: true, maxResolution: "720p", creditsPerSecond: 8 },
  { id: "seedance-2.0-video-extend", mode: "v2v", label: "Seedance 2.0 Video Extend (assemble)", fast: false, maxResolution: "1080p", creditsPerSecond: 10 },
  { id: "seedance-2.0-fast-video-extend", mode: "v2v", label: "Seedance 2.0 Fast Video Extend", fast: true, maxResolution: "720p", creditsPerSecond: 8 },
];

export function getSeedanceModel(id: string): SeedanceModel | undefined {
  return SEEDANCE_MODELS.find((m) => m.id === id);
}

const RES_MULTIPLIER: Record<string, number> = { "480p": 1, "720p": 1, "1080p": 1.5 };

// Offline credit estimate (UI preview / tests). Runtime uses provider.quote().
export function estimateSeedanceCredits(
  modelId: string,
  params: SeedanceGenerateParams
): number {
  const model = getSeedanceModel(modelId);
  if (!model) return 0;
  const duration = params.duration ?? 10;
  const mult = RES_MULTIPLIER[params.resolution ?? "720p"] ?? 1;
  return Math.round(model.creditsPerSecond * duration * mult);
}

const MAX = { imageUrls: 9, videoUrls: 3, audioUrls: 3 };

// §4.2 constraints — enforce BEFORE any spend.
export function validateSeedanceParams(
  modelId: string,
  params: SeedanceGenerateParams
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const model = getSeedanceModel(modelId);
  if (!model) {
    return { ok: false, errors: [`Unknown model: ${modelId}`] };
  }

  // Duration window 4..15.
  const duration = params.duration ?? 10;
  if (duration < 4 || duration > 15) {
    errors.push("duration must be between 4 and 15 seconds");
  }

  // Fast tiers cap at 720p.
  if (model.fast && params.resolution === "1080p") {
    errors.push(`${modelId} (fast tier) does not support 1080p`);
  }
  if (params.resolution === "1080p" && model.maxResolution !== "1080p") {
    errors.push(`${modelId} does not support 1080p`);
  }

  // Cardinality caps.
  if ((params.imageUrls?.length ?? 0) > MAX.imageUrls) {
    errors.push(`imageUrls exceeds max of ${MAX.imageUrls}`);
  }
  if ((params.videoUrls?.length ?? 0) > MAX.videoUrls) {
    errors.push(`videoUrls exceeds max of ${MAX.videoUrls}`);
  }
  if ((params.audioUrls?.length ?? 0) > MAX.audioUrls) {
    errors.push(`audioUrls exceeds max of ${MAX.audioUrls}`);
  }

  const hasFrame = Boolean(params.startFrame || params.endFrame);
  const hasRefs =
    Boolean(params.imageUrls?.length) ||
    Boolean(params.videoUrls?.length) ||
    Boolean(params.audioUrls?.length);

  // Frames are exclusive with references (identity vs continuity, never both).
  if (hasFrame && hasRefs) {
    errors.push(
      "startFrame/endFrame cannot be combined with imageUrls/videoUrls/audioUrls (a clip is either identity mode or continuity mode)"
    );
  }

  // Audio can't be the sole input.
  if (params.audioUrls?.length) {
    const hasOther =
      Boolean(params.imageUrls?.length) ||
      Boolean(params.videoUrls?.length) ||
      Boolean(params.startFrame) ||
      Boolean(params.endFrame);
    if (!hasOther) {
      errors.push(
        "audioUrls requires at least one of imageUrls / videoUrls / startFrame / endFrame"
      );
    }
  }

  // Mode-specific required inputs.
  if (modelId.includes("video-edit") && !params.videoUrl) {
    errors.push("video-edit requires a source videoUrl");
  }
  if (modelId.includes("video-extend") && !(params.videoUrls?.length)) {
    errors.push("video-extend requires 1-3 source videoUrls");
  }

  return { ok: errors.length === 0, errors };
}
