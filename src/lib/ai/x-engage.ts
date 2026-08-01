import { z } from "zod";
import { generateText, Output } from "ai";
import { getModel, getModelId, estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import { buildPositioningBlock } from "@/lib/ai/brand-positioning";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { BrandPositioning } from "@/lib/ai/brand-positioning";
import { stripBannedDashes } from "@/lib/blog/content-flags";

// Strict-output rule: every field must be required (nullable, not optional).
const engagementSchema = z.object({
  reply: z.string(),
  quoteTweet: z.string(),
  action: z.enum(["reply", "quote", "both", "skip"]),
  reasoning: z.string(),
  opportunityScore: z.number(),
});

export type XEngagementSuggestion = z.infer<typeof engagementSchema>;

const postIdeasSchema = z.object({
  ideas: z.array(
    z.object({
      text: z.string(),
      format: z.enum(["text", "thread", "media", "poll"]),
      inspiredBy: z.string(),
      whyItWorks: z.string(),
    })
  ),
});

export type XPostIdea = z.infer<typeof postIdeasSchema>["ideas"][number];

export async function generateEngagementSuggestion(input: {
  tenantSlug: string;
  tweetText: string;
  authorHandle: string;
  authorFollowers: number | null;
  likes: number;
  signalType: "keyword" | "account_monitor" | "trending";
  matchedKeyword: string | null;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
}): Promise<XEngagementSuggestion> {
  // gpt-4o-mini: structured short-form copy, 13× cheaper than gpt-4.1 with same quality
  const model = getModel("scoring");
  const modelId = getModelId("scoring");
  const started = Date.now();

  const voiceDesc = input.voice
    ? `Tone: ${input.voice.tone}. Target audience: ${input.voice.audience}. Dos: ${input.voice.do_list.slice(0, 3).join(", ")}. Avoid: ${input.voice.dont_list.slice(0, 2).join(", ")}.`
    : "Conversational, helpful, direct.";

  const posBlock = buildPositioningBlock(input.positioning);

  const system = `You are a social media strategist generating X (Twitter) engagement suggestions.
Write entirely in the brand's voice — never generic, never salesy. Be genuine and add real value.

Brand voice: ${voiceDesc}

${posBlock}

Rules:
- reply: A direct reply to the tweet. Genuine, adds a perspective or question. Max 250 chars.
- quoteTweet: Retweet with YOUR take that adds insight for your audience. Max 220 chars (the quoted tweet adds ~30 chars).
- action: "reply" = only reply, "quote" = only quote-tweet, "both" = do both, "skip" = tweet is off-brand or low-value.
- reasoning: one sentence on WHY this action maximises visibility or builds community.
- opportunityScore: 1-10. 10 = highly relevant niche topic, large-audience author, viral potential.`;

  const user = `Signal: ${input.signalType}${input.matchedKeyword ? ` (matched keyword: "${input.matchedKeyword}")` : ""}
Author: @${input.authorHandle}${input.authorFollowers ? ` · ${input.authorFollowers.toLocaleString()} followers` : ""}
Likes: ${input.likes}

Tweet:
"${input.tweetText.slice(0, 500)}"

Generate the reply, quote tweet, recommended action, reasoning, and opportunity score.`;

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: engagementSchema }),
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
      feature: "x_engage_suggest",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return {
      ...result.output,
      reply: stripBannedDashes(result.output.reply, input.voice),
      quoteTweet: stripBannedDashes(result.output.quoteTweet, input.voice),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "x_engage_suggest",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: msg,
    });
    throw new Error(msg);
  }
}

export async function generatePostIdeas(input: {
  tenantSlug: string;
  topPosts: Array<{ handle: string; text: string; likes: number; signalType: string }>;
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
}): Promise<XPostIdea[]> {
  // gpt-4o-mini: creative short-form tweet ideas, 13× cheaper than gpt-4.1
  const model = getModel("scoring");
  const modelId = getModelId("scoring");
  const started = Date.now();

  const voiceDesc = input.voice
    ? `Tone: ${input.voice.tone}. Target audience: ${input.voice.audience}. Dos: ${input.voice.do_list.slice(0, 3).join(", ")}. Avoid: ${input.voice.dont_list.slice(0, 2).join(", ")}.`
    : "Conversational, authentic, direct.";

  const posBlock = buildPositioningBlock(input.positioning);

  const postsBlock = input.topPosts
    .slice(0, 8)
    .map((p, i) => `${i + 1}. @${p.handle} (${p.likes} likes): "${p.text.slice(0, 200)}"`)
    .join("\n");

  const system = `You are a viral content strategist. Study what's working for accounts in this niche and generate ORIGINAL post ideas the brand should tweet — not copies, but inspired originals.

Brand voice: ${voiceDesc}

${posBlock}

Formats:
- text: single tweet, under 280 chars
- thread: opening tweet for a thread (start with "🧵" or a hook)
- media: tweet that works best paired with an image or short video
- poll: a question formatted as a Twitter poll option

For each idea:
- text: the exact tweet copy, ready to post
- format: the recommended format
- inspiredBy: "@handle's post about X"
- whyItWorks: one sentence on the content principle it uses (curiosity gap, social proof, opinion, etc.)`;

  const user = `Top-performing posts from monitored accounts:
${postsBlock}

Generate 4 original post ideas this brand should tweet this week, each inspired by a different post above.`;

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: postIdeasSchema }),
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
      feature: "x_post_ideas",
      model: modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
    return result.output.ideas.map((idea) => ({
      ...idea,
      text: stripBannedDashes(idea.text, input.voice),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "synthesis",
      feature: "x_post_ideas",
      model: modelId,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: msg,
    });
    throw new Error(msg);
  }
}
