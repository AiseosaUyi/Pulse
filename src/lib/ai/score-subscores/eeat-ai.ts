// E-E-A-T — 10 pts. Hybrid: 6 deterministic + 4 AI.
// Rubric v1 §7.

import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import { loadPrompt, renderTemplate } from "@/lib/ai/prompts";
import type { ScoreIssue, SubScoreResult } from "./types";

const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

export interface EeatInputs {
  tenantSlug: string;
  title: string;
  content: string;
  /** Whether a byline is present in the post metadata (author name). */
  hasAuthorByline?: boolean;
}

const AUTHORITY_DOMAINS = [
  /\.gov(\.[a-z]+)?$/i,
  /\.edu(\.[a-z]+)?$/i,
  /wikipedia\.org$/i,
  /nytimes\.com$/i,
  /reuters\.com$/i,
  /bbc\.co\.uk$/i,
  /ft\.com$/i,
  /hbr\.org$/i,
  /mit\.edu$/i,
];

function extractOutboundLinks(content: string): string[] {
  const out: string[] = [];
  const mdLink = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/g;
  let m;
  while ((m = mdLink.exec(content))) out.push(m[1]);
  const bare = /(?<![(\[])(https?:\/\/[^\s)]+)/g;
  while ((m = bare.exec(content))) out.push(m[1]);
  return out;
}

function isAuthoritative(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return AUTHORITY_DOMAINS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

function hasCitationPattern(content: string): boolean {
  return /(?:\[source:\s*[^\]]+\]|according to\b|(?:via|per)\s+[A-Z][a-z]+)/i.test(
    content
  );
}

const eeatSchema = z.object({
  specificity: z.number().int().min(0).max(2),
  appropriate_hedging: z.number().int().min(0).max(2),
  notes: z.object({
    specificity: z.string(),
    appropriate_hedging: z.string(),
  }),
});

export async function scoreEeat(inp: EeatInputs): Promise<SubScoreResult> {
  const issues: ScoreIssue[] = [];

  // Deterministic checks (6 pts)
  const links = extractOutboundLinks(inp.content);
  const authoritative = links.filter(isAuthoritative).length;
  let linksScore = 0;
  if (authoritative >= 2) linksScore = 3;
  else if (authoritative === 1) linksScore = 2;
  else linksScore = 0;
  if (linksScore < 3) {
    issues.push({
      subScore: "eeat",
      severity: "med",
      message: `Only ${authoritative} authoritative outbound links (.gov, .edu, major news, etc.).`,
      suggestedFix: "Add 2+ citations to authoritative sources.",
    });
  }

  let citationScore = hasCitationPattern(inp.content) ? 2 : 0;
  if (citationScore < 2) {
    issues.push({
      subScore: "eeat",
      severity: "low",
      message: "No inline citations (e.g. 'according to X', '[source: Y]').",
      suggestedFix: "Cite the source of any claim, stat, or study inline.",
    });
  }

  const bylineScore = inp.hasAuthorByline ? 1 : 0;
  if (bylineScore < 1) {
    issues.push({
      subScore: "eeat",
      severity: "low",
      message: "No author byline.",
      suggestedFix: "Add a byline for Google's E-E-A-T signals.",
    });
  }

  // AI (4 pts)
  const started = Date.now();
  let spec = 1;
  let hedge = 1;
  let aiNotes: { specificity?: string; appropriate_hedging?: string } = {};
  try {
    const prompt = loadPrompt("scoring/eeat");
    const user = renderTemplate(prompt.userTemplate, {
      post_title: inp.title,
      post_content: inp.content,
    });
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: eeatSchema }),
      system: prompt.system,
      prompt: user,
    });
    spec = result.output.specificity;
    hedge = result.output.appropriate_hedging;
    aiNotes = result.output.notes;

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const providerMeta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = providerMeta.cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });
    await logAiCall({
      tenantSlug: inp.tenantSlug,
      purpose: "scoring",
      feature: "blog_score_eeat",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });
  } catch (err) {
    await logAiCall({
      tenantSlug: inp.tenantSlug,
      purpose: "scoring",
      feature: "blog_score_eeat",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    issues.push({
      subScore: "eeat",
      severity: "low",
      message: "E-E-A-T AI rater failed — used neutral fallback.",
      suggestedFix: "Rescore to get an accurate expertise read.",
    });
  }

  if (spec < 2) {
    issues.push({
      subScore: "eeat",
      severity: "low",
      message: `Specificity ${spec}/2 — ${aiNotes.specificity ?? "too abstract"}`,
      suggestedFix: "Replace generic statements with concrete examples or numbers.",
    });
  }
  if (hedge < 2) {
    issues.push({
      subScore: "eeat",
      severity: "low",
      message: `Hedging calibration ${hedge}/2 — ${aiNotes.appropriate_hedging ?? "off"}`,
      suggestedFix: "Claim certainty where earned; hedge on projections and trends.",
    });
  }

  return {
    score: linksScore + citationScore + bylineScore + spec + hedge,
    max: 10,
    issues,
  };
}
