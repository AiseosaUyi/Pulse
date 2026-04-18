// Content score orchestrator. Runs all 7 sub-scorers (deterministic
// + AI) in parallel and returns the total + per-sub-score result +
// flattened issues list. Contract in docs/content-score-rubric.md.
//
// Persist the return value to `blog_posts.content_score` /
// `sub_scores` / `score_issues` so the UI side panel renders it
// without re-scoring on every load.

import { scoreSeo } from "@/lib/ai/score-subscores/seo";
import { scoreReadability } from "@/lib/ai/score-subscores/readability";
import { scoreStructure } from "@/lib/ai/score-subscores/structure";
import { scoreFaq } from "@/lib/ai/score-subscores/faq";
import { scoreAlignment } from "@/lib/ai/score-subscores/alignment-ai";
import { scoreDepth } from "@/lib/ai/score-subscores/depth-ai";
import { scoreEeat } from "@/lib/ai/score-subscores/eeat-ai";
import type { ScoreIssue, SubScoreKey } from "@/lib/ai/score-subscores/types";
import type { BrandPositioning } from "@/lib/ai/brand-positioning";
import type { BrandVoice } from "@/lib/ai/brand-voice";

export interface ScoreBlogInput {
  tenantSlug: string;
  post: {
    title: string;
    metaDescription: string | null;
    content: string;
    outline?: Array<{ heading: string; bullets: string[] }>;
    targetKeyword: string | null;
    secondaryKeywords: string[];
    slug?: string | null;
    faqSchema?: unknown | null;
    hasAuthorByline?: boolean;
    targetWordCount?: number;
  };
  positioning: BrandPositioning | null;
  voice: BrandVoice | null;
  serpContext?: {
    topResults: Array<{ title: string; url: string; snippet: string }>;
    userPosition?: number;
  };
}

export interface SubScores {
  alignment: { score: number; max: number };
  seo: { score: number; max: number };
  readability: { score: number; max: number };
  depth: { score: number; max: number };
  structure: { score: number; max: number };
  faq: { score: number; max: number };
  eeat: { score: number; max: number };
}

export interface ScoreBlogResult {
  /** 0-100 total. Target ≥ 80 to ship. */
  total: number;
  subScores: SubScores;
  issues: ScoreIssue[];
  computedAt: string;
}

const DEFAULT_TARGET_WORDS = 1200;

function rankSeverity(s: ScoreIssue["severity"]): number {
  return s === "high" ? 0 : s === "med" ? 1 : 2;
}

function rankSubScore(k: SubScoreKey): number {
  // Deterministic ordering — alignment + SEO first (the biggest
  // weights), then structure/depth/faq/eeat/readability by
  // descending user impact.
  const order: SubScoreKey[] = [
    "alignment",
    "seo",
    "depth",
    "structure",
    "faq",
    "eeat",
    "readability",
  ];
  return order.indexOf(k);
}

export async function scoreBlogPost(
  input: ScoreBlogInput
): Promise<ScoreBlogResult> {
  const target = input.post.targetWordCount ?? DEFAULT_TARGET_WORDS;

  // Fire deterministic + AI scorers in parallel. Each AI scorer has
  // its own try/catch + fallback, so Promise.all is safe.
  const [
    alignment,
    seo,
    readability,
    depth,
    structure,
    faq,
    eeat,
  ] = await Promise.all([
    scoreAlignment({
      tenantSlug: input.tenantSlug,
      title: input.post.title,
      content: input.post.content,
      positioning: input.positioning,
      voice: input.voice,
    }),
    Promise.resolve(
      scoreSeo({
        title: input.post.title,
        metaDescription: input.post.metaDescription,
        content: input.post.content,
        targetKeyword: input.post.targetKeyword,
        secondaryKeywords: input.post.secondaryKeywords,
        slug: input.post.slug ?? null,
      })
    ),
    Promise.resolve(scoreReadability({ content: input.post.content })),
    scoreDepth({
      tenantSlug: input.tenantSlug,
      title: input.post.title,
      content: input.post.content,
      targetKeyword: input.post.targetKeyword,
      targetWordCount: target,
      positioning: input.positioning,
      serpContext: input.serpContext?.topResults,
    }),
    Promise.resolve(scoreStructure({ content: input.post.content })),
    Promise.resolve(
      scoreFaq({
        content: input.post.content,
        faqSchema: input.post.faqSchema ?? null,
      })
    ),
    scoreEeat({
      tenantSlug: input.tenantSlug,
      title: input.post.title,
      content: input.post.content,
      hasAuthorByline: input.post.hasAuthorByline,
    }),
  ]);

  const total =
    alignment.score +
    seo.score +
    readability.score +
    depth.score +
    structure.score +
    faq.score +
    eeat.score;

  const issues = [
    ...alignment.issues,
    ...seo.issues,
    ...readability.issues,
    ...depth.issues,
    ...structure.issues,
    ...faq.issues,
    ...eeat.issues,
  ].sort((a, b) => {
    const sev = rankSeverity(a.severity) - rankSeverity(b.severity);
    if (sev !== 0) return sev;
    return rankSubScore(a.subScore) - rankSubScore(b.subScore);
  });

  return {
    total,
    subScores: {
      alignment: { score: alignment.score, max: alignment.max },
      seo: { score: seo.score, max: seo.max },
      readability: { score: readability.score, max: readability.max },
      depth: { score: depth.score, max: depth.max },
      structure: { score: structure.score, max: structure.max },
      faq: { score: faq.score, max: faq.max },
      eeat: { score: eeat.score, max: eeat.max },
    },
    issues,
    computedAt: new Date().toISOString(),
  };
}
