// Provider-agnostic video-generation contract. Everything the video engine
// needs from a generation backend goes through this interface; no provider
// SDK/HTTP leaks outside the concrete implementation (e.g. picsart.ts). A
// future swap to a direct Seedance/BytePlus API is then a one-file change.

export type VideoMode = "t2v" | "v2v";

export interface VideoModel {
  id: string; // e.g. "seedance-2.0"
  mode: VideoMode;
  label?: string;
}

// Raw provider param schema (shape varies by provider) — surfaced to the UI
// for dynamic forms; we don't over-type it.
export type ParamSchema = Record<string, unknown>;

// The generation params we build for a Seedance call. URLs are public asset
// URLs (preferred) or provider asset uids. Identity mode uses imageUrls;
// continuity mode uses startFrame/endFrame; replicate uses videoUrl(s).
export interface SeedanceGenerateParams {
  prompt?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive";
  resolution?: "480p" | "720p" | "1080p";
  duration?: number; // seconds
  generateAudio?: boolean;
  returnLastFrame?: boolean;
  imageUrls?: string[]; // reference images (identity), max 9
  videoUrls?: string[]; // reference / extend source videos, max 3
  audioUrls?: string[]; // reference audios, max 3
  startFrame?: string; // continuity in
  endFrame?: string; // continuity out
  videoUrl?: string; // single source video for *-video-edit
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface QuoteResult {
  credits: number;
}

export interface GenerateResult {
  jobId: string;
}

export type PollStatus = "pending" | "running" | "succeeded" | "failed";

export interface PollResult {
  status: PollStatus;
  resultUrl?: string; // mp4 result
  lastFrameUrl?: string; // when returnLastFrame was requested
  error?: string;
}

export interface UploadResult {
  uid: string;
  url: string;
}

export interface CreditBalance {
  balance: number;
  nextResetDate?: string;
}

export interface VideoProvider {
  listModels(filter?: { mode?: VideoMode }): Promise<VideoModel[]>;
  getModelParams(modelId: string): Promise<ParamSchema>;
  validateParams(
    modelId: string,
    params: SeedanceGenerateParams
  ): Promise<ValidationResult>;
  /** DRY-RUN price in credits. Must run before every generate(). No spend. */
  quote(modelId: string, params: SeedanceGenerateParams): Promise<QuoteResult>;
  /** Spends credits. Returns an async job handle to poll. */
  generate(
    modelId: string,
    params: SeedanceGenerateParams
  ): Promise<GenerateResult>;
  poll(jobId: string): Promise<PollResult>;
  uploadAsset(fileOrUrl: Blob | string): Promise<UploadResult>;
  creditBalance(): Promise<CreditBalance>;
}
