// PicsArt gen-ai implementation of VideoProvider (ByteDance Seedance 2.0).
// The ONLY file that touches the PicsArt HTTP API. Server-only — the API key
// never reaches the client. Dormant until PICSART_API_KEY is set.
//
// NOTE: the endpoint paths below follow the operation surface documented in the
// build brief (list_models, model_params, validate_params, pricing, generate,
// upload, credits) under base https://api.picsart.com/gen-ai. Confirm the exact
// paths + response shapes against the live account when the key is provisioned;
// they're centralized in ENDPOINTS so any correction is a one-place change.
// Response parsing is intentionally defensive.

import {
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

const BASE = "https://api.picsart.com/gen-ai";

const ENDPOINTS = {
  listModels: `${BASE}/models`,
  modelParams: (id: string) => `${BASE}/models/${id}/params`,
  pricing: `${BASE}/pricing`, // dry-run quote
  generate: (id: string) => `${BASE}/models/${id}/generate`,
  poll: (jobId: string) => `${BASE}/generations/${jobId}`,
  upload: `${BASE}/upload`,
  credits: `${BASE}/credits`,
};

export function isPicsartConfigured(): boolean {
  return Boolean(process.env.PICSART_API_KEY);
}

/** Credits→USD factor for telemetry (one-time top-ups ~0.0075, volume ~0.0045). */
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

  private async req<T>(
    url: string,
    init: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON response
    }
    if (!res.ok) {
      const msg =
        (json as { message?: string; error?: string } | null)?.message ??
        (json as { error?: string } | null)?.error ??
        `PicsArt API ${res.status}`;
      throw new PicsartError(msg, res.status);
    }
    return json as T;
  }

  async listModels(filter?: { mode?: "t2v" | "v2v" }): Promise<VideoModel[]> {
    // Catalog is stable + verified offline; the remote list is advisory.
    const models = SEEDANCE_MODELS.map((m) => ({
      id: m.id,
      mode: m.mode,
      label: m.label,
    }));
    return filter?.mode ? models.filter((m) => m.mode === filter.mode) : models;
  }

  async getModelParams(modelId: string): Promise<ParamSchema> {
    return this.req<ParamSchema>(ENDPOINTS.modelParams(modelId));
  }

  async validateParams(
    modelId: string,
    params: SeedanceGenerateParams
  ): Promise<ValidationResult> {
    // Local §4.2 enforcement is the source of truth; cheap + offline.
    return validateSeedanceParams(modelId, params);
  }

  async quote(
    modelId: string,
    params: SeedanceGenerateParams
  ): Promise<QuoteResult> {
    const body = JSON.stringify({ model: modelId, ...toApiParams(params) });
    const json = await this.req<{ credits?: number; price?: number }>(
      ENDPOINTS.pricing,
      { method: "POST", body }
    );
    const credits = json.credits ?? json.price;
    if (typeof credits !== "number") {
      throw new PicsartError("quote() returned no credit amount");
    }
    return { credits };
  }

  async generate(
    modelId: string,
    params: SeedanceGenerateParams
  ): Promise<GenerateResult> {
    const body = JSON.stringify(toApiParams(params));
    const json = await this.req<{ id?: string; jobId?: string }>(
      ENDPOINTS.generate(modelId),
      { method: "POST", body }
    );
    const jobId = json.id ?? json.jobId;
    if (!jobId) throw new PicsartError("generate() returned no job id");
    return { jobId };
  }

  async poll(jobId: string): Promise<PollResult> {
    const json = await this.req<{
      status?: string;
      state?: string;
      result?: { url?: string; lastFrameUrl?: string };
      url?: string;
      error?: string;
    }>(ENDPOINTS.poll(jobId));
    const raw = (json.status ?? json.state ?? "").toLowerCase();
    const status: PollStatus =
      raw === "success" || raw === "succeeded" || raw === "done"
        ? "succeeded"
        : raw === "failed" || raw === "error"
          ? "failed"
          : raw === "running" || raw === "processing"
            ? "running"
            : "pending";
    return {
      status,
      resultUrl: json.result?.url ?? json.url,
      lastFrameUrl: json.result?.lastFrameUrl,
      error: json.error,
    };
  }

  async uploadAsset(fileOrUrl: Blob | string): Promise<UploadResult> {
    let json: { uid?: string; id?: string; url?: string };
    if (typeof fileOrUrl === "string") {
      json = await this.req(ENDPOINTS.upload, {
        method: "POST",
        body: JSON.stringify({ url: fileOrUrl }),
      });
    } else {
      const form = new FormData();
      form.append("file", fileOrUrl);
      json = await this.req(ENDPOINTS.upload, { method: "POST", body: form });
    }
    const uid = json.uid ?? json.id;
    if (!uid || !json.url) throw new PicsartError("upload() returned no uid/url");
    return { uid, url: json.url };
  }

  async creditBalance(): Promise<CreditBalance> {
    const json = await this.req<{
      balance?: number;
      credits?: number;
      nextResetDate?: string;
    }>(ENDPOINTS.credits);
    const balance = json.balance ?? json.credits ?? 0;
    return { balance, nextResetDate: json.nextResetDate };
  }
}

// Map our typed params to the provider's wire field names (§4.1 schema).
function toApiParams(p: SeedanceGenerateParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.prompt !== undefined) out.prompt = p.prompt;
  if (p.aspectRatio !== undefined) out.aspectRatio = p.aspectRatio;
  if (p.resolution !== undefined) out.resolution = p.resolution;
  if (p.duration !== undefined) out.duration = p.duration;
  if (p.generateAudio !== undefined) out.generateAudio = p.generateAudio;
  if (p.returnLastFrame !== undefined) out.returnLastFrame = p.returnLastFrame;
  if (p.imageUrls?.length) out.imageUrls = p.imageUrls;
  if (p.videoUrls?.length) out.videoUrls = p.videoUrls;
  if (p.audioUrls?.length) out.audioUrls = p.audioUrls;
  if (p.startFrame) out.startFrame = p.startFrame;
  if (p.endFrame) out.endFrame = p.endFrame;
  if (p.videoUrl) out.videoUrl = p.videoUrl;
  return out;
}

/** Returns the configured provider, or throws if PICSART_API_KEY is unset. */
export function getPicsartProvider(): VideoProvider {
  const key = process.env.PICSART_API_KEY;
  if (!key) {
    throw new PicsartError("PICSART_API_KEY is not configured");
  }
  return new PicsartVideoProvider(key);
}
