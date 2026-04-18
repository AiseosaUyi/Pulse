// Whisper transcription wrapper. Direct REST against OpenAI's
// /v1/audio/transcriptions so we don't have to negotiate the AI SDK's
// transcription adapter (it's minor at the per-call scale we use here).
//
// Cost: ~$0.006 per minute of audio. The feedback panel caps
// recording at 5 minutes → ≤ $0.03 per transcription. No streaming;
// Whisper doesn't support it.
//
// Input: a Blob or Uint8Array + filename. Most common callsite is a
// webm recording downloaded from Supabase Storage.

import { logAiCall } from "@/lib/ai/gateway";

export interface TranscribeInput {
  audio: Blob | Uint8Array;
  filename: string;
  tenantSlug: string;
  feature?: string;
  /** Override the default Whisper model if needed. */
  model?: "whisper-1";
  /** ISO-639-1 code to bias transcription. Default: auto-detect. */
  language?: string;
}

export interface TranscribeResult {
  text: string;
  durationMs: number;
  costUsd: number;
}

export class TranscriptionError extends Error {}

const WHISPER_USD_PER_MINUTE = 0.006;

export async function transcribeAudio(
  input: TranscribeInput
): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new TranscriptionError("OPENAI_API_KEY not set");
  }

  const form = new FormData();
  const blob =
    input.audio instanceof Blob
      ? input.audio
      : new Blob([new Uint8Array(input.audio)], { type: "audio/webm" });
  form.append("file", blob, input.filename);
  form.append("model", input.model ?? "whisper-1");
  form.append("response_format", "verbose_json");
  if (input.language) form.append("language", input.language);

  const start = Date.now();
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const durationMs = Date.now() - start;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TranscriptionError(
      `Whisper ${res.status}: ${body.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as { text: string; duration?: number };
  const seconds = json.duration ?? 0;
  const costUsd = (seconds / 60) * WHISPER_USD_PER_MINUTE;

  await logAiCall({
    tenantSlug: input.tenantSlug,
    feature: input.feature ?? "blog_feedback_transcribe",
    model: `openai/${input.model ?? "whisper-1"}`,
    purpose: "transcription",
    inputTokens: 0,
    outputTokens: 0,
    costUsd,
    durationMs,
    success: true,
  });

  return { text: json.text, durationMs, costUsd };
}
