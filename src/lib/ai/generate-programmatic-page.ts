import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import type { BrandVoice } from "@/lib/ai/brand-voice";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

export const programmaticPageSchema = z.object({
  title: z.string().min(1),
  meta_description: z.string().min(1),
  body_md: z.string().min(100),
});

export type GeneratedProgrammaticPage = z.infer<typeof programmaticPageSchema>;

export interface GeneratePageInput {
  tenantSlug: string;
  tenantName: string;
  voice: BrandVoice | null;
  titlePattern: string;
  metaDescriptionPattern: string | null;
  contentPrompt: string;
  targetWordCount: number;
  variables: Record<string, string>;
}

/**
 * Interpolates {varName} tokens in a pattern with values.
 * Unknown tokens are left as-is (caller should validate).
 */
export function interpolate(
  pattern: string,
  variables: Record<string, string>
): string {
  return pattern.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(variables, key)
      ? variables[key]
      : `{${key}}`
  );
}

/**
 * Expands a variable set into every combination (cartesian product).
 * [{name:"city",values:["lagos","abuja"]},{name:"type",values:["wedding"]}]
 *   → [{city:"lagos",type:"wedding"},{city:"abuja",type:"wedding"}]
 */
export function expandVariables(
  vars: { name: string; values: string[] }[]
): Record<string, string>[] {
  if (vars.length === 0) return [{}];
  const [first, ...rest] = vars;
  const tail = expandVariables(rest);
  return first.values.flatMap((v) =>
    tail.map((t) => ({ ...t, [first.name]: v }))
  );
}

/**
 * Slugifies a string: lowercase, replace non-alphanum with hyphens, collapse.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function generateProgrammaticPage(
  input: GeneratePageInput
): Promise<{ page: GeneratedProgrammaticPage; costUsd: number }> {
  const started = Date.now();

  const resolvedTitle = interpolate(input.titlePattern, input.variables);
  const resolvedMeta = input.metaDescriptionPattern
    ? interpolate(input.metaDescriptionPattern, input.variables)
    : null;
  const resolvedPrompt = interpolate(input.contentPrompt, input.variables);

  const voiceBlock = input.voice
    ? [
        "Brand voice:",
        `- Tone: ${input.voice.tone}`,
        `- Audience: ${input.voice.audience}`,
        `- Do: ${input.voice.do_list.join(" | ")}`,
        `- Don't: ${input.voice.dont_list.join(" | ")}`,
      ].join("\n")
    : "No brand voice configured — keep it plainspoken, specific, no generic SEO filler.";

  const varLines = Object.entries(input.variables)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const system = [
    `You write programmatic SEO landing pages for ${input.tenantName}.`,
    voiceBlock,
    "",
    "Rules:",
    `- Target ~${input.targetWordCount} words. Don't pad.`,
    "- Use the provided title verbatim as the H1. Don't paraphrase it.",
    "- Use the provided meta description verbatim if one is given.",
    "- Markdown body: ## for section headings, ### for subheadings. Start WITHOUT the H1 (we render it separately).",
    "- Write specifically for the variable values. Don't be generic.",
    "- If a variable implies a location, include one or two concrete references (neighborhoods, venues, known spots). No fabricated data (prices, addresses).",
    "- Return ONLY JSON matching the schema.",
  ].join("\n");

  const user = [
    `Title (H1, use verbatim): ${resolvedTitle}`,
    resolvedMeta
      ? `Meta description (use verbatim): ${resolvedMeta}`
      : "Meta description: write a 140-160 char action-oriented meta description.",
    "",
    "Variables for this page:",
    varLines,
    "",
    "Content brief:",
    resolvedPrompt,
    "",
    "Draft the page.",
  ].join("\n");

  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: programmaticPageSchema }),
      system,
      prompt: user,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const meta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = meta.cachedPromptTokens ?? 0;
    const costUsd = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "programmatic_generate",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd,
      durationMs: Date.now() - started,
      success: true,
    });

    return { page: result.output, costUsd };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "programmatic_generate",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
