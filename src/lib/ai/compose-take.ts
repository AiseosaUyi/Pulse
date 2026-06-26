// Composer AI — draft platform-native social variants in the brand's voice.
//
// Single structured-output call returns five platform variants + 3 hook
// alternatives simultaneously. X is always the primary draft.
//
// Per OpenAI strict-mode gotcha: all fields use .nullable() (not .optional())
// so they stay in the required array while still being droppable.

import { generateText, Output } from "ai";
import { z } from "zod";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import {
  buildPositioningBlock,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";

export const composeModes = ["original", "reply", "quote"] as const;
export type ComposeMode = (typeof composeModes)[number];

export const composeTakeSchema = z.object({
  x: z
    .string()
    .max(280)
    .nullable()
    .describe(
      "X/Twitter variant — one strong idea, punchy opener, no hashtag spam. HARD limit: 280 chars."
    ),
  linkedin: z
    .string()
    .max(3000)
    .nullable()
    .describe(
      "LinkedIn variant — professional, insights-first, paragraph format. Opens with a hook sentence."
    ),
  instagram: z
    .string()
    .max(2200)
    .nullable()
    .describe(
      "Instagram caption — conversational, 3-5 relevant hashtags at the end, closes with a question or CTA."
    ),
  tiktok: z
    .string()
    .max(2200)
    .nullable()
    .describe(
      "TikTok caption — short, energetic, written for TikTok's audience. 3-5 trending hashtags."
    ),
  youtube: z
    .string()
    .max(5000)
    .nullable()
    .describe(
      "YouTube community post — informative, keyword-rich, more detail is OK."
    ),
  hooks: z
    .array(z.string().max(100))
    .length(3)
    .nullable()
    .describe(
      "3 alternate opening lines for the X variant. Short, punchy, each a different angle. The user swaps one in to replace the first sentence."
    ),
});

export type ComposeTakeResult = z.infer<typeof composeTakeSchema>;

export class ComposeAiError extends Error {
  constructor(
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = "ComposeAiError";
  }
}

export interface ComposeTakeInput {
  tenantSlug: string;
  mode: ComposeMode;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
  sourceUrl?: string | null;
  angle?: string | null;
  primaryPlatform?: string | null;
}

export async function composeTakeAi(
  input: ComposeTakeInput
): Promise<{ result: ComposeTakeResult; model: string; costUsd: number }> {
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");
  const started = Date.now();

  const system = buildComposeSystem(input);
  const user = buildComposeUser(input);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: composeTakeSchema }),
      system,
      prompt: user,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "compose_take",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return { result: result.output, model: modelId, costUsd: cost };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "compose_take",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: msg,
    });
    throw new ComposeAiError(msg, err);
  }
}

function buildComposeSystem(input: ComposeTakeInput): string {
  const { mode, voice } = input;
  const modeLine: Record<ComposeMode, string> = {
    original:
      "Write a standalone original post on the angle/topic — it stands alone without the linked context.",
    reply:
      "Write a reply to the linked/quoted post — direct, in-conversation, concise and additive.",
    quote:
      "Write a quote-post: short commentary the user posts ABOVE the shared link, adding their own angle.",
  };

  const lines = [
    "You are a ghostwriter generating platform-native social variants in the user's authentic voice.",
    "Produce one underlying insight or angle — adapted for five platforms at once.",
    "All variants must feel like the same person speaking natively on each platform, not the same post resized.",
    "",
    `Mode: ${mode}. ${modeLine[mode]}`,
    "",
    "Platform rules:",
    "- x: HARD limit 280 chars. One clear idea. Punchy opener. No hashtag spam. Thread hook openers OK.",
    "- linkedin: Up to 3000 chars. Open with a hook. Professional angle. Use short paragraphs. Insights-first.",
    "- instagram: Up to 2200 chars. Conversational. End with 3-5 relevant hashtags. Close with a question or CTA.",
    "- tiktok: Up to 2200 chars. Short and punchy. 3-5 trending hashtags. Written for TikTok's young audience.",
    "- youtube: Up to 5000 chars. Informative community post or video description. Keyword-rich. More detail OK.",
    "- hooks: Exactly 3 short, punchy alternate opening lines for the X variant — each a distinct angle on the same take.",
    "",
    "Hard rules across all variants:",
    "- Match the brand voice exactly: tone, do's, don'ts, and the cadence of the example posts.",
    "- Keep each variant tight. One idea, said well. Delete words that don't earn their place.",
    "- No hashtags on X or LinkedIn unless the example posts use them.",
    "- No emoji unless the example posts use them. No hype, no 'in today's world' openers.",
    "- Sound like a real person with a point of view, not a brand account or an AI.",
    "- Return content for all 5 platforms. Only return null if the platform is truly inappropriate for this take.",
  ];

  if (input.primaryPlatform) {
    const platformFocus: Record<string, string[]> = {
      x: [
        "PRIMARY PLATFORM IS X: Make the X variant the anchor. Aim for the tightest, most punch-per-word version possible.",
        "Spend extra care on the hook — it must work in the first 10 words. The other platforms can derive from this energy.",
      ],
      linkedin: [
        "PRIMARY PLATFORM IS LINKEDIN: Write the LinkedIn variant as the anchor, with full depth and storytelling.",
        "Aim for 800-2000 chars. Open with a hook sentence on its own line. Follow with a personal story, lesson, or insight in 2-4 short paragraphs.",
        "End with a clear takeaway or question. Use line breaks generously. Professional but human — not a brand account.",
        "Derive the other platforms from this depth, adapted to their formats.",
      ],
      instagram: [
        "PRIMARY PLATFORM IS INSTAGRAM: Write the Instagram caption as the anchor.",
        "Warm, visual, conversational. Strong first line that stops the scroll. 3-5 tight paragraphs max. 5 relevant hashtags at the end. Close with a question or CTA.",
      ],
      tiktok: [
        "PRIMARY PLATFORM IS TIKTOK: Write the TikTok caption as the anchor.",
        "Short, punchy, youth-culture aware. Hook in the first line. 3-5 trending hashtags. Sounds like a real creator, not a brand.",
      ],
      youtube: [
        "PRIMARY PLATFORM IS YOUTUBE: Write the YouTube community post as the anchor.",
        "Informative, keyword-rich, can be longer (aim for 400-1000 chars). Great for driving traffic or sharing a lesson from a video.",
      ],
    };
    const focusLines = platformFocus[input.primaryPlatform];
    if (focusLines) {
      lines.push("", ...focusLines);
    }
  }

  if (voice) {
    lines.push(
      "",
      "Brand voice:",
      `- Tone: ${voice.tone}`,
      `- Audience: ${voice.audience}`,
      `- Do: ${voice.do_list.join("; ")}`,
      `- Don't: ${voice.dont_list.join("; ")}`,
      "- Example posts (match this cadence and personality exactly):",
      ...voice.example_posts.slice(0, 5).map((p) => `    • ${p}`)
    );
  } else {
    lines.push(
      "",
      "No brand voice configured — write plainly and conversationally in the first person; don't invent a persona."
    );
  }

  lines.push("", buildPositioningBlock(input.positioning));
  return lines.join("\n");
}

function buildComposeUser(input: ComposeTakeInput): string {
  const { sourceUrl, angle } = input;
  const lines: string[] = [];
  if (sourceUrl) lines.push(`Link / context: ${sourceUrl}`);
  if (angle) lines.push(`The user's angle (their words): ${angle}`);
  if (lines.length === 0) {
    lines.push(
      "The user gave no specifics. Draft a strong, on-brand original take on a topic this brand cares about (pick one from the positioning topics)."
    );
  }
  lines.push(
    "",
    "Generate all five platform variants and three hook alternatives now."
  );
  return lines.join("\n");
}
