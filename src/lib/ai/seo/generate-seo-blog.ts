// SEO blog generator. Fork of src/lib/ai/generate-brief.ts adapted for
// long-form SEO drafts with SERP context and meta-tag output.
//
// Pipeline:
//   1. checkAiBudget(tenantSlug) — fail fast before any AI call
//   2. getBrandContext(tenantSlug) — voice + positioning
//   3. SERP context via Serper (top 10 for primary keyword)
//   4. One gpt-5 call (purpose="seo-longform") with strict structured output
//   5. logAiCall(feature="seo_blog_generate")
//
// Schema follows the .nullable() convention from CLAUDE.md — every field
// is required in the Zod object; nullable fields can be null but cannot
// be absent. This is what OpenAI strict mode demands.
//
// Word-count target is derived from competitors (+15%) when SERP context
// is available; otherwise falls back to 1200 to match score-blog's
// DEFAULT_TARGET_WORDS.

import { generateText, Output } from "ai";
import { z } from "zod";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";
import { checkAiBudget } from "@/lib/ai/ai-budget";
import {
  getBrandContext,
  buildPositioningBlock,
} from "@/lib/ai/brand-positioning";
import {
  scrapeViaSerper,
  isSerperConfigured,
  SerperError,
} from "@/lib/scrape/serper-serp";
import type { SerpResult } from "@/lib/scrape/google-serp";

export const seoBlogSchema = z.object({
  title: z.string().min(1).max(120),
  slug: z.string().min(1).max(120),
  excerpt: z.string().min(40).max(220),
  seo_meta_title: z.string().min(20).max(70),
  seo_meta_description: z.string().min(110).max(170),
  primary_keyword: z.string().min(1),
  secondary_keywords: z.array(z.string()),
  outline: z.array(
    z.object({
      h2: z.string().min(1),
      h3s: z.array(z.string()),
      bullets: z.array(z.string()),
    })
  ),
  body_markdown: z.string().min(500),
  faq: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
    })
  ),
  internal_link_targets: z.array(
    z.object({
      anchor_text: z.string().min(1),
      target_slug_hint: z.string().nullable(),
      reason: z.string().min(1),
    })
  ),
  schema_candidates: z.array(
    z.enum(["Article", "BlogPosting", "FAQPage", "HowTo", "VideoObject"])
  ),
  target_word_count: z.number().int().min(400).max(5000),
});

export type GeneratedSeoBlog = z.infer<typeof seoBlogSchema>;

export class SeoBlogGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "SeoBlogGenerationError";
  }
}

export interface GenerateSeoBlogInput {
  tenantSlug: string;
  tenantName: string;
  primaryKeyword: string;
  /** Optional brief to anchor the draft (carries outline / angle). */
  brief?: {
    title?: string;
    outline?: string[];
    angle?: string | null;
  };
  /** Override the SERP region (default ng = Nigeria per Gruve). */
  region?: string;
}

interface SerpSnapshot {
  topResults: SerpResult[];
  avgTitleLength: number | null;
  serpFeatures: string[];
  fetched: boolean;
  fetchError: string | null;
}

async function fetchSerpSnapshot(
  primaryKeyword: string,
  region: string
): Promise<SerpSnapshot> {
  if (!isSerperConfigured()) {
    return {
      topResults: [],
      avgTitleLength: null,
      serpFeatures: [],
      fetched: false,
      fetchError: "SERPER_API_KEY not configured",
    };
  }
  try {
    const results = await scrapeViaSerper({
      query: primaryKeyword,
      region,
      limit: 10,
    });
    const avgTitleLength = results.length
      ? results.reduce((acc, r) => acc + r.title.length, 0) / results.length
      : null;
    const features = Array.from(
      new Set(
        results.flatMap((r) => r.serp_features ?? [])
      )
    );
    return {
      topResults: results,
      avgTitleLength,
      serpFeatures: features,
      fetched: true,
      fetchError: null,
    };
  } catch (err) {
    const msg =
      err instanceof SerperError ? `${err.status}: ${err.message}` : String(err);
    return {
      topResults: [],
      avgTitleLength: null,
      serpFeatures: [],
      fetched: false,
      fetchError: msg,
    };
  }
}

export async function generateSeoBlog(
  input: GenerateSeoBlogInput
): Promise<GeneratedSeoBlog> {
  // Budget check first — no AI cost incurred on rejected calls.
  await checkAiBudget(input.tenantSlug);

  const [{ voice, positioning }, serp] = await Promise.all([
    getBrandContext(input.tenantSlug),
    fetchSerpSnapshot(input.primaryKeyword, input.region ?? "ng"),
  ]);

  const model = getModel("seo-longform");
  const modelId = getModelId("seo-longform");
  const started = Date.now();

  const system = buildSystemPrompt(input.tenantName, voice, positioning);
  const user = buildUserPrompt(input, serp);

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: seoBlogSchema }),
      system,
      prompt: user,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const meta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = meta.cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "seo-longform",
      feature: "seo_blog_generate",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return result.output;
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "seo-longform",
      feature: "seo_blog_generate",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new SeoBlogGenerationError(
      "Failed to generate SEO blog draft",
      err
    );
  }
}

function buildSystemPrompt(
  tenantName: string,
  voice: Awaited<ReturnType<typeof getBrandContext>>["voice"],
  positioning: Awaited<ReturnType<typeof getBrandContext>>["positioning"]
): string {
  const voiceBlock = voice
    ? [
        "Brand voice:",
        `- Tone: ${voice.tone}`,
        `- Audience: ${voice.audience}`,
        `- Do: ${voice.do_list.join(" | ")}`,
        `- Don't: ${voice.dont_list.join(" | ")}`,
        ...(voice.example_posts.length
          ? [
              "Examples of our voice:",
              ...voice.example_posts
                .slice(0, 3)
                .map((p, i) => `  ${i + 1}. ${p}`),
            ]
          : []),
      ].join("\n")
    : "No brand voice configured — write in plain professional English.";

  return [
    `You write SEO-optimized blog posts for ${tenantName}.`,
    "",
    voiceBlock,
    "",
    buildPositioningBlock(positioning),
    "",
    "Output rules:",
    "- body_markdown uses GitHub-flavored Markdown. Use H2 (##) and H3 (###) only — no H1 (the page title is rendered separately).",
    "- seo_meta_title 40-65 chars; lead with the primary keyword when natural.",
    "- seo_meta_description 120-160 chars with a CTA verb; never clickbait.",
    "- excerpt 50-200 chars; first-person plural OK when it matches voice.",
    "- internal_link_targets: suggest anchor text + topic hint; the platform resolves the actual slug.",
    "- schema_candidates: include 'Article' or 'BlogPosting' always; add 'FAQPage' when faq[] is non-empty; add 'HowTo' only if body is procedural with numbered steps.",
    "- If voice forbids a topic, refuse to cover it in body_markdown.",
    "- Never invent statistics. Cite sources by linking out only when the source is visible in the SERP context provided.",
  ].join("\n");
}

function buildUserPrompt(
  input: GenerateSeoBlogInput,
  serp: SerpSnapshot
): string {
  const serpBlock = serp.fetched
    ? [
        "Top 10 SERP results for the primary keyword:",
        ...serp.topResults.map(
          (r, i) =>
            `  ${i + 1}. [${r.domain}] ${r.title} — ${r.snippet.slice(0, 200)}`
        ),
        serp.serpFeatures.length
          ? `SERP features present: ${serp.serpFeatures.join(", ")}`
          : "SERP features: none detected.",
        serp.avgTitleLength
          ? `Average competitor title length: ${Math.round(serp.avgTitleLength)} chars.`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : `SERP context unavailable (${serp.fetchError ?? "unknown"}). Generate based on topic understanding only — do NOT fabricate competitor angles.`;

  const briefBlock = input.brief
    ? [
        "Existing brief to ground the draft in:",
        input.brief.title ? `- Title: ${input.brief.title}` : "",
        input.brief.outline?.length
          ? `- Outline: ${input.brief.outline.join(" → ")}`
          : "",
        input.brief.angle ? `- Angle: ${input.brief.angle}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "No prior brief — generate from the keyword.";

  return [
    `Primary keyword: ${input.primaryKeyword}`,
    "",
    briefBlock,
    "",
    serpBlock,
    "",
    "Task: produce a full SEO blog draft. Aim for the SERP's average word count +15%, capped at 2500 words. Differentiate from the top 10 with a specific stance grounded in our positioning. Use H2/H3 hierarchy; include at least one FAQ block at the end if the SERP shows a People Also Ask box.",
  ].join("\n");
}
