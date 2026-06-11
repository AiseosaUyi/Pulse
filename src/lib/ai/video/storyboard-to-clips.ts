// Turns an approved creative source (a Content-Engine plan's scenes, or a
// blog/brief body) into executable Seedance clips. Reuses the existing video
// PLAN as the creative input — this is the structuring pass, not a new
// storyboard generator. Brand-conditioned, structured output, telemetry like
// every other AI call. No credits spent here (LLM only).

import { generateText, Output } from "ai";
import { z } from "zod";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";
import {
  buildPositioningBlock,
  getBrandContext,
} from "@/lib/ai/brand-positioning";
import type { ContentPlanScene } from "@/lib/types/content-engine";

// Per CLAUDE.md: required-but-nullable fields use `.nullable()` (strict mode).
const clipSchema = z.object({
  seq: z.number().int().min(1),
  prompt: z
    .string()
    .min(10)
    .describe(
      "A complete Seedance-ready clip prompt: subject, action, setting, lighting, camera. Self-contained for this clip."
    ),
  model: z
    .enum(["seedance-2.0", "seedance-2.0-fast"])
    .describe(
      "seedance-2.0 (Pro) when a person/spokesperson features (identity matters); seedance-2.0-fast for b-roll / non-human / product motion."
    ),
  duration_s: z.number().int().min(4).max(15),
  mode: z
    .enum(["identity", "continuity"])
    .describe(
      "identity = a fresh shot of a recurring person (uses reference images); continuity = this clip continues the previous shot's motion (uses the last frame)."
    ),
  features_person: z
    .boolean()
    .describe("True if a recurring human character appears in this clip."),
  character_hint: z
    .string()
    .nullable()
    .describe("Short label for the recurring person if one is implied, else null."),
});

export const clipsSchema = z.object({
  clips: z.array(clipSchema).min(1),
});

export type GeneratedClip = z.infer<typeof clipSchema>;

export class StoryboardError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "StoryboardError";
  }
}

export type StoryboardSource =
  | { kind: "scenes"; scenes: ContentPlanScene[]; readyPrompt?: string | null }
  | { kind: "text"; title: string; body: string };

export interface StoryboardInput {
  tenantSlug: string;
  tenantName: string;
  source: StoryboardSource;
  aspectRatio: string;
  targetResolution: string;
}

export interface StoryboardResult {
  clips: GeneratedClip[];
  model: string;
  costUsd: number;
}

export async function storyboardToClips(
  input: StoryboardInput
): Promise<StoryboardResult> {
  const model = getModel("video-storyboard");
  const modelId = getModelId("video-storyboard");
  const started = Date.now();
  const { voice, positioning } = await getBrandContext(input.tenantSlug);

  const system = [
    `You are ${input.tenantName}'s video director. Break the brief into executable short-form clips for the Seedance text-to-video model.`,
    "Rules: one clip per distinct shot. Each prompt is self-contained and visual. Clip duration 4-15s. Keep the SAME recurring character described consistently across clips (use character_hint). Use 'continuity' only when a clip literally continues the prior shot's motion; otherwise 'identity'. Pick seedance-2.0 when a person features, seedance-2.0-fast for b-roll.",
    voice ? `Tone: ${voice.tone}. Audience: ${voice.audience}.` : "",
    buildPositioningBlock(positioning),
    `Target aspect ratio ${input.aspectRatio}, resolution ${input.targetResolution}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const user =
    input.source.kind === "scenes"
      ? [
          "Storyboard scenes:",
          ...input.source.scenes.map(
            (s) =>
              `Scene ${s.scene}: ${s.description}${s.dialogue ? ` | dialogue: ${s.dialogue}` : ""} | camera: ${s.camera} | emotion: ${s.emotion}`
          ),
          input.source.readyPrompt ? `\nCreative reference: ${input.source.readyPrompt}` : "",
          "\nProduce one clip per scene (seq matching the scene number).",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `Title: ${input.source.title}`,
          "",
          input.source.body.slice(0, 6000),
          "",
          "Produce 3-6 clips that tell this as a short video.",
        ].join("\n");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: clipsSchema }),
      system,
      prompt: user,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cacheRead =
      ((result.providerMetadata?.openai ?? {}) as { cachedPromptTokens?: number })
        .cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "video-storyboard",
      feature: "video_storyboard",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    // Normalize seq to be 1..n contiguous.
    const clips = result.output.clips
      .sort((a, b) => a.seq - b.seq)
      .map((c, i) => ({ ...c, seq: i + 1 }));

    return { clips, model: modelId, costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "video-storyboard",
      feature: "video_storyboard",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new StoryboardError("Failed to structure storyboard into clips", err);
  }
}
