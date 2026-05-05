// Blog ideation. Mirrors the video-plan ideation pattern: the user
// picks a TYPE and we produce N candidate ideas (just title +
// premise + keyword + angle) — full post generation kicks off only
// once the user picks one.
//
// Types:
//   educational | tips | engagement | thought_leadership | listicle |
//   case_study | comparison | how_to | feature_announcement
//
// feature_announcement is special: it doesn't brainstorm. The user
// supplies feature_meta (name, what, audience, benefits) and we
// produce ONE polished topic that reflects those inputs.

import { generateText, Output } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
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
import { listTrendScouts } from "@/lib/services/trends";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildVoiceBlock } from "@/lib/ai/generate-blog-post";

// ── blog types ──────────────────────────────────────────────
export const BLOG_TYPES = [
  "educational",
  "tips",
  "engagement",
  "thought_leadership",
  "listicle",
  "case_study",
  "comparison",
  "how_to",
  "feature_announcement",
] as const;
export type BlogType = (typeof BLOG_TYPES)[number];

export const BLOG_TYPE_LABELS: Record<BlogType, string> = {
  educational: "Educational",
  tips: "Tips & best practices",
  engagement: "Engagement / opinion",
  thought_leadership: "Thought leadership",
  listicle: "Listicle",
  case_study: "Case study",
  comparison: "Comparison",
  how_to: "How-to guide",
  feature_announcement: "Feature announcement",
};

export const BLOG_TYPE_DESCRIPTIONS: Record<BlogType, string> = {
  educational:
    "Teach the audience something useful in your domain. Reader leaves smarter.",
  tips: "Practical, actionable tips a reader can apply today.",
  engagement:
    "Opinion / hot take / industry commentary designed to spark conversation.",
  thought_leadership:
    "Bigger-picture argument or framework that positions us as a category authority.",
  listicle: "Numbered list — scannable, share-friendly, great for SEO.",
  case_study: "A specific story: customer or internal — what we did + the result.",
  comparison: "Compare options / approaches / tools so the reader can decide.",
  how_to: "Step-by-step guide to accomplish a concrete outcome.",
  feature_announcement:
    "Introduce a new product feature, what it does, who benefits.",
};

export type FeatureAudience = "creators" | "users" | "both";

export interface FeatureMeta {
  name: string;
  about: string;
  audience: FeatureAudience;
  benefits: string;
}

// ── output schema ───────────────────────────────────────────
// Per CLAUDE.md: every property required-but-nullable when optional.
const ideaSchema = z.object({
  title: z
    .string()
    .min(8)
    .describe("Working blog title. Specific, scroll-stopping, not clickbait."),
  premise: z
    .string()
    .min(30)
    .describe(
      "2-3 sentences on what this post will argue / cover / prove. Concrete."
    ),
  target_keyword: z
    .string()
    .min(2)
    .describe("Primary SEO keyword to target. Realistic for the brand to rank."),
  secondary_keywords: z
    .array(z.string().min(2))
    .describe("3-6 supporting keyword phrases — empty array if none obvious."),
  angle: z
    .string()
    .min(10)
    .describe(
      "What makes THIS post worth writing for THIS brand — its unique angle or hook."
    ),
  trending_signal: z
    .string()
    .nullable()
    .describe(
      "Which trending topic / hashtag / SEO signal informed this idea. Null if no trend was leveraged."
    ),
});

const batchSchema = z.object({
  ideas: z.array(ideaSchema).min(1).max(5),
});

export type GeneratedBlogIdea = z.infer<typeof ideaSchema>;

export class BlogIdeationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "BlogIdeationError";
  }
}

// ── prompt builders ─────────────────────────────────────────
function trendsBlock(
  trends: Awaited<ReturnType<typeof listTrendScouts>>
): string {
  if (trends.length === 0) {
    return "No live trend signals captured for this tenant. Lean on positioning + the blog type alone.";
  }
  const top = trends.slice(0, 8);
  const lines = ["Live trend signals (use as inspiration where relevant):"];
  for (const t of top) {
    const tag = t.hashtag ? `#${t.hashtag}` : t.title ?? "(untitled)";
    const applic = t.applicability ? ` — applicability: ${t.applicability}` : "";
    const why = t.aiAnalysis?.why_viral
      ? ` — why: ${t.aiAnalysis.why_viral.slice(0, 120)}`
      : "";
    lines.push(`- ${t.platform} · ${tag}${applic}${why}`);
  }
  return lines.join("\n");
}

function buildSystemPrompt(args: {
  tenantName: string;
  blogType: BlogType;
  voiceBlock: string;
  positioningBlock: string;
  trendBlock: string;
  count: number;
  isFeature: boolean;
}): string {
  const lines: string[] = [
    `You are generating ${args.count === 1 ? "ONE" : args.count + " distinct"} blog post idea${args.count === 1 ? "" : "s"} for ${args.tenantName}.`,
    "",
    `Blog type: ${BLOG_TYPE_LABELS[args.blogType]} — ${BLOG_TYPE_DESCRIPTIONS[args.blogType]}`,
    "",
    args.voiceBlock,
    "",
    args.positioningBlock,
    "",
    args.trendBlock,
    "",
    "Output rules:",
    "- Each idea is just a CONCEPT — title + premise + keyword + angle. Do NOT draft the full post yet.",
    "- Title is specific. No generic 'Ultimate Guide to X' filler.",
    "- target_keyword must be realistic for THIS brand to rank for. Look at competitors — pick gaps where we can compete.",
    "- secondary_keywords: 3-6 supporting phrases. Empty array if nothing else fits.",
    "- angle: ONE specific reason this post is worth writing for THIS brand specifically (not a generic blog).",
    "- trending_signal: name a real trend from the signals above when you used one to shape the idea. Null otherwise — never invent a trend.",
    "- Strictly avoid topics_to_avoid from positioning.",
  ];
  if (args.count > 1) {
    lines.push(
      "- The N ideas must be DIFFERENT angles / formats / sub-topics. Don't return three variations of the same idea."
    );
  }
  if (args.isFeature) {
    lines.push(
      "",
      "FEATURE ANNOUNCEMENT MODE:",
      "- The user has supplied feature_meta. Treat the announcement itself as the topic.",
      "- Title should NAME or strongly hint at the feature.",
      "- Premise covers: what shipped, who benefits, why it matters now.",
      "- target_keyword leans branded ('<tenant> <feature>') unless an obviously stronger SEO phrase exists in their domain."
    );
  }
  return lines.join("\n");
}

function buildUserPrompt(args: {
  blogType: BlogType;
  count: number;
  feature: FeatureMeta | null;
  competitorBriefs: string;
  extraContext?: string;
}): string {
  const parts: string[] = [];
  parts.push(`Generate ${args.count} idea${args.count === 1 ? "" : "s"} for a "${BLOG_TYPE_LABELS[args.blogType]}" post.`);

  if (args.feature) {
    parts.push("", "Feature meta:");
    parts.push(`- Feature name: ${args.feature.name}`);
    parts.push(`- What it is: ${args.feature.about}`);
    parts.push(
      `- Who benefits: ${
        args.feature.audience === "both"
          ? "creators AND users"
          : args.feature.audience
      }`
    );
    parts.push(`- Benefits: ${args.feature.benefits}`);
  }

  if (args.competitorBriefs) {
    parts.push("", args.competitorBriefs);
  }

  if (args.extraContext) {
    parts.push("", `Additional context: ${args.extraContext}`);
  }

  parts.push("", "Return as structured JSON matching the schema.");
  return parts.join("\n");
}

// ── public api ──────────────────────────────────────────────
export interface GenerateBlogIdeasInput {
  tenantSlug: string;
  blogType: BlogType;
  /** Required when blogType === 'feature_announcement'. Ignored otherwise. */
  feature?: FeatureMeta;
  extraContext?: string;
  createdBy?: string | null;
}

export interface GeneratedIdeaRow extends GeneratedBlogIdea {
  id: string;
  batchId: string;
  blogType: BlogType;
}

export async function generateBlogIdeas(
  input: GenerateBlogIdeasInput
): Promise<{ batchId: string; ideas: GeneratedIdeaRow[] }> {
  const isFeature = input.blogType === "feature_announcement";
  if (isFeature && !input.feature) {
    throw new BlogIdeationError(
      "feature_announcement requires feature meta (name, about, audience, benefits)."
    );
  }
  const count = isFeature ? 1 : 3;

  const admin = createAdminClient();
  const [brand, trends, tenantRow] = await Promise.all([
    getBrandContext(input.tenantSlug),
    listTrendScouts(input.tenantSlug, { limit: 12 }).catch(() => []),
    admin
      .from("tenants")
      .select("name")
      .eq("slug", input.tenantSlug)
      .maybeSingle()
      .then((r) => r.data),
  ]);

  const tenantName = (tenantRow?.name as string | undefined) ?? input.tenantSlug;

  const voiceBlock = buildVoiceBlock(brand.voice);
  const positioningBlock = buildPositioningBlock(brand.positioning);
  const trendBlock = trendsBlock(trends);

  const competitorBriefs =
    brand.positioning && brand.positioning.competitors.length > 0
      ? `Competitors we benchmark: ${brand.positioning.competitors
          .map((c) => c.name)
          .slice(0, 5)
          .join(", ")} — find SEO gaps and angles they haven't owned.`
      : "";

  const system = buildSystemPrompt({
    tenantName,
    blogType: input.blogType,
    voiceBlock,
    positioningBlock,
    trendBlock,
    count,
    isFeature,
  });

  const user = buildUserPrompt({
    blogType: input.blogType,
    count,
    feature: input.feature ?? null,
    competitorBriefs,
    extraContext: input.extraContext,
  });

  // Cheap model — ideas are short JSON, no need for gpt-4.1.
  const model = getModel("scoring");
  const modelId = getModelId("scoring");
  const started = Date.now();

  let parsed: z.infer<typeof batchSchema>;
  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: batchSchema }),
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
      purpose: "scoring",
      feature: "blog_ideate",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    parsed = result.output;

    // Persist ideas — they're cheap + lets us audit/regenerate.
    const batchId = randomUUID();
    const trimmed = parsed.ideas.slice(0, count);
    const rows = trimmed.map((idea) => ({
      tenant_slug: input.tenantSlug,
      batch_id: batchId,
      blog_type: input.blogType,
      title: idea.title,
      premise: idea.premise,
      target_keyword: idea.target_keyword,
      secondary_keywords: idea.secondary_keywords,
      angle: idea.angle,
      trending_signal: idea.trending_signal,
      feature_meta: input.feature ?? null,
      status: "pending" as const,
      generator_model: modelId,
      generator_cost_usd: cost / Math.max(trimmed.length, 1),
      created_by: input.createdBy ?? null,
    }));

    const { data: inserted, error: insertErr } = await admin
      .from("blog_post_ideas")
      .insert(rows)
      .select("*");

    if (insertErr || !inserted) {
      throw new BlogIdeationError(
        `Failed to persist ideas: ${insertErr?.message ?? "unknown"}`
      );
    }

    const out: GeneratedIdeaRow[] = inserted.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row.id as string,
        batchId: row.batch_id as string,
        blogType: row.blog_type as BlogType,
        title: row.title as string,
        premise: row.premise as string,
        target_keyword: row.target_keyword as string,
        secondary_keywords: (row.secondary_keywords as string[]) ?? [],
        angle: (row.angle as string) ?? "",
        trending_signal: (row.trending_signal as string | null) ?? null,
      };
    });

    return { batchId, ideas: out };
  } catch (err) {
    if (err instanceof BlogIdeationError) throw err;
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "scoring",
      feature: "blog_ideate",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new BlogIdeationError("Failed to generate blog ideas", err);
  }
}
