// Rewrites a few rough facts about an author into an authority-commanding,
// E-E-A-T bio — enriched from the tenant's brand positioning ("about import").
// Third person, factual, niche-authoritative; never fabricates credentials.

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, getModelId, estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import {
  getBrandPositioning,
  buildPositioningBlock,
} from "@/lib/ai/brand-positioning";

const bioSchema = z.object({
  bio: z.string(),
});

export async function rewriteAuthorBio(input: {
  tenantSlug: string;
  name: string;
  title?: string | null;
  facts?: string | null;
}): Promise<{ bio: string; costUsd: number }> {
  const started = Date.now();
  const positioning = await getBrandPositioning(input.tenantSlug);
  const positioningBlock = buildPositioningBlock(positioning);

  const system = [
    "You write concise, authority-commanding author bios for a brand's blog.",
    "Goals: establish E-E-A-T (experience, expertise, authoritativeness, trust)",
    "and position the author as a credible voice in the brand's niche — this",
    "feeds schema.org Person and helps SEO/AI-answer credibility.",
    "",
    "Rules:",
    "- Third person. 1-2 sentences (~25-45 words). No first person, no fluff.",
    "- Ground it in the supplied facts + the brand's space; do NOT invent",
    "  titles, employers, awards, or numbers that weren't given.",
    "- Make the niche authority explicit (what they know + why they're credible).",
    "",
    positioningBlock,
  ].join("\n");

  const prompt = [
    `Author name: ${input.name}`,
    input.title ? `Role/title: ${input.title}` : "",
    `Facts provided: ${input.facts?.trim() || "(none — infer a credible, generic-but-authoritative bio from the brand's space)"}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generateText({
      model: getModel("synthesis"),
      output: Output.object({ schema: bioSchema }),
      system,
      prompt,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const modelId = getModelId("synthesis");
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "author_bio_rewrite",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return { bio: result.output.bio.trim(), costUsd: cost };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "author_bio_rewrite",
      model: getModelId("synthesis"),
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
