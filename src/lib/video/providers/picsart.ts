// PicsArt GenAI implementation of VideoProvider (Seedance 2.0 + others).
// The ONLY file that touches the PicsArt HTTP API. Server-only.
//
// VERIFIED LIVE (2026-06-12) against a real key:
//   base    https://genai-api.picsart.io
//   auth    header  X-Picsart-API-Key: <key>
//   t2v     POST /v1/text2video   { prompt, model(URN), quality, length, audio, width, height } -> 202 { status, inference_id }
//   i2v     POST /v1/image2video  { image_url, prompt, model(URN), quality, length, audio, width, height } -> 202 { inference_id }
//   result  GET  /v1/video/{inference_id}  -> 202 {status:"processing"} | 200 {status:"success", data:{url}}
// Models are URNs (text-to-video vs image-to-video variants). No dry-run
// pricing endpoint exists, so quote() returns an offline estimate; the budget
// gate uses that and PicsArt deducts the real credits on generate.

import {
  estimateSeedanceCredits,
  validateSeedanceParams,
  SEEDANCE_MODELS,
} from "./seedance-constraints";
import type {
  CreditBalance,
  GenerateResult,
  ParamSchema,
  PollResult,
  PollStatus,
  QuoteResult,
  SeedanceGenerateParams,
  UploadResult,
  ValidationResult,
  VideoModel,
  VideoProvider,
} from "./types";

const BASE = "https://genai-api.picsart.io";

// Friendly model id (used across the app/UI) → PicsArt model URN, per endpoint.
const TEXT2VIDEO_URN: Record<string, string> = {
  "seedance-2.0": "urn:air:seedance:model:seedance:seedance-2.0-text-to-video@1",
  "seedance-1.5": "urn:air:seedance:model:seedance:seedance-1.5-pro-text-to-video@1",
  "kling-3.0": "urn:air:kling:model:kling:kling-v3-text-to-video@1",
  "seedance-2.0-fast": "urn:air:seedance:model:seedance:seedance-1.0-pro-fast-text-to-video@1",
};
// image2video: Seedance 1.5 Pro is the verified image-to-video model.
const IMAGE2VIDEO_URN = "urn:air:seedance:model:seedance:seedance-1.5-pro-image-to-video@1";

const ASPECT_WH: Record<string, { width: number; height: number }> = {
  "9:16": { width: 576, height: 1024 },
  "16:9": { width: 1024, height: 576 },
  "1:1": { width: 1024, height: 1024 },
  "4:3": { width: 1024, height: 768 },
  "3:4": { width: 768, height: 1024 },
  "21:9": { width: 1024, height: 439 },
  adaptive: { width: 1024, height: 1024 },
};

export function isPicsartConfigured(): boolean {
  return Boolean(process.env.PICSART_API_KEY);
}

export function picsartCreditUsd(): number {
  const raw = Number(process.env.PICSART_CREDIT_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.005;
}

export class PicsartError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "PicsartError";
  }
}

class PicsartVideoProvider implements VideoProvider {
  constructor(private apiKey: string) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<{ status: number; json: T }> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "X-Picsart-API-Key": this.apiKey,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (res.status >= 400) {
      const msg = (json as { detail?: string; message?: string } | null)?.detail
        ?? (json as { message?: string } | null)?.message
        ?? `PicsArt API ${res.status}`;
      throw new PicsartError(msg, res.status);
    }
    return { status: res.status, json: json as T };
  }

  async listModels(filter?: { mode?: "t2v" | "v2v" }): Promise<VideoModel[]> {
    const models = SEEDANCE_MODELS.map((m) => ({ id: m.id, mode: m.mode, label: m.label }));
    return filter?.mode ? models.filter((m) => m.mode === filter.mode) : models;
  }

  async getModelParams(): Promise<ParamSchema> {
    return { quality: ["480p", "720p", "1080p"], length: "1-20", audio: "boolean" };
  }

  async validateParams(modelId: string, params: SeedanceGenerateParams): Promise<ValidationResult> {
    return validateSeedanceParams(modelId, params);
  }

  // No PicsArt pricing endpoint — offline estimate (budget gate uses this).
  async quote(modelId: string, params: SeedanceGenerateParams): Promise<QuoteResult> {
    return { credits: estimateSeedanceCredits(modelId, params) };
  }

  async generate(modelId: string, params: SeedanceGenerateParams): Promise<GenerateResult> {
    const imageUrl = params.startFrame ?? params.imageUrls?.[0];
    const wh = ASPECT_WH[params.aspectRatio ?? "16:9"] ?? ASPECT_WH["16:9"];
    const common = {
      prompt: params.prompt ?? "",
      quality: params.resolution ?? "720p",
      length: params.duration ?? 10,
      audio: params.generateAudio ?? false,
      width: wh.width,
      height: wh.height,
    };

    if (params.videoUrl) {
      // PicsArt's basic GenAI video API exposes text2video + image2video only;
      // there's no verified video-to-video (replicate) endpoint yet.
      throw new PicsartError("Recreate (video-to-video) isn't available on the PicsArt GenAI API yet");
    }

    let path: string;
    let body: Record<string, unknown>;
    if (imageUrl) {
      path = "/v1/image2video";
      body = { ...common, image_url: imageUrl, model: IMAGE2VIDEO_URN };
    } else {
      path = "/v1/text2video";
      body = { ...common, model: TEXT2VIDEO_URN[modelId] ?? TEXT2VIDEO_URN["seedance-2.0"] };
    }

    const { json } = await this.req<{ inference_id?: string; id?: string }>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const jobId = json.inference_id ?? json.id;
    if (!jobId) throw new PicsartError("generate() returned no inference_id");
    return { jobId };
  }

  async poll(jobId: string): Promise<PollResult> {
    const { status, json } = await this.req<{
      status?: string;
      data?: { url?: string };
    }>(`/v1/video/${jobId}`);
    const raw = (json.status ?? "").toLowerCase();
    const mapped: PollStatus =
      raw === "success" || raw === "done" || raw === "completed"
        ? "succeeded"
        : raw === "failed" || raw === "error"
          ? "failed"
          : status === 200 && json.data?.url
            ? "succeeded"
            : "running";
    return {
      status: mapped,
      resultUrl: json.data?.url,
      error: raw === "failed" ? "generation failed" : undefined,
    };
  }

  // Our assets are stored as public Supabase URLs, which image2video accepts
  // directly via image_url — so uploads are a passthrough for URL strings.
  async uploadAsset(fileOrUrl: Blob | string): Promise<UploadResult> {
    if (typeof fileOrUrl === "string") return { uid: fileOrUrl, url: fileOrUrl };
    throw new PicsartError("Provide a public asset URL; PicsArt accepts image_url directly");
  }

  // Real remaining GenAI credits. GET /v1/balance → { "credits": <int> }.
  // This is the live truth PicsArt bills against, so the budget gate uses it to
  // hard-stop before a generation that would overrun the plan.
  async creditBalance(): Promise<CreditBalance> {
    const { json } = await this.req<{ credits?: number }>("/v1/balance", { method: "GET" });
    if (typeof json.credits !== "number") {
      throw new PicsartError("balance endpoint returned no credits");
    }
    return { balance: json.credits };
  }
}

export function getPicsartProvider(): VideoProvider {
  const key = process.env.PICSART_API_KEY;
  if (!key) throw new PicsartError("PICSART_API_KEY is not configured");
  return new PicsartVideoProvider(key);
}
