// Content score orchestrator — rubric v1 implementation.
//
// Breakdown:
//   Deterministic (pure TS, free, fast):
//     - SEO (20 pts)          — src/lib/ai/score-subscores/seo.ts
//     - Readability (15 pts)  — src/lib/ai/score-subscores/readability.ts
//     - Structure (10 pts)    — src/lib/ai/score-subscores/structure.ts
//     - FAQ (10 pts)          — src/lib/ai/score-subscores/faq.ts
//     - Alignment cap (-5)    — alignment-deterministic.ts (banned topics)
//     - Depth det (6 pts)     — depth-deterministic.ts (word-band + specificity)
//     - E-E-A-T det (6 pts)   — eeat-deterministic.ts (links + citations + byline)
//
//   AI (single call, gpt-4o-mini via purpose="scoring"):
//     - Alignment (20 pts)          — AI rates four 0-5 criteria
//     - Depth originality (9 pts)   — AI rates two criteria
//     - E-E-A-T expertise (4 pts)   — AI rates two criteria
//
// Rationale: one combined AI call eliminates duplicate post-content
// token cost (~65% saving) and gpt-4o-mini pricing vs gpt-4.1 is
// ~13x cheaper per token. Net ~3-4x total reduction on per-post
// scoring cost. See commit message for before/after numbers.

import { scoreSeo } from "@/lib/ai/score-subscores/seo";
import { scoreReadability } from "@/lib/ai/score-subscores/readability";
import { scoreStructure } from "@/lib/ai/score-subscores/structure";
import { scoreFaq } from "@/lib/ai/score-subscores/faq";
import { scoreAlignmentDeterministic } from "@/lib/ai/score-subscores/alignment-deterministic";
import { scoreDepthDeterministic } from "@/lib/ai/score-subscores/depth-deterministic";
import { scoreEeatDeterministic } from "@/lib/ai/score-subscores/eeat-deterministic";
import { runCombinedAiScore } from "@/lib/ai/score-subscores/combined-ai";
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
  /** AI call cost (USD) for this score pass — for the iterate loop's cost cap. */
  aiCostUsd: number;
  computedAt: string;
}

const DEFAULT_TARGET_WORDS = 1200;

function rankSeverity(s: ScoreIssue["severity"]): number {
  return s === "high" ? 0 : s === "med" ? 1 : 2;
}

function rankSubScore(k: SubScoreKey): number {
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
  const p = input.post;

  // Fire deterministic scorers + the single combined AI call in parallel.
  const [seo, readability, structure, faq, alignmentDet, depthDet, eeatDet, aiResult] =
    await Promise.all([
      Promise.resolve(
        scoreSeo({
          title: p.title,
          metaDescription: p.metaDescription,
          content: p.content,
          targetKeyword: p.targetKeyword,
          secondaryKeywords: p.secondaryKeywords,
          slug: p.slug ?? null,
        })
      ),
      Promise.resolve(scoreReadability({ content: p.content })),
      Promise.resolve(scoreStructure({ content: p.content })),
      Promise.resolve(
        scoreFaq({ content: p.content, faqSchema: p.faqSchema ?? null })
      ),
      Promise.resolve(
        scoreAlignmentDeterministic({
          title: p.title,
          content: p.content,
          positioning: input.positioning,
        })
      ),
      Promise.resolve(
        scoreDepthDeterministic({
          content: p.content,
          targetWordCount: target,
        })
      ),
      Promise.resolve(
        scoreEeatDeterministic({
          content: p.content,
          hasAuthorByline: p.hasAuthorByline,
        })
      ),
      runCombinedAiScore({
        tenantSlug: input.tenantSlug,
        title: p.title,
        content: p.content,
        targetKeyword: p.targetKeyword,
        positioning: input.positioning,
        voice: input.voice,
        serpContext: input.serpContext?.topResults,
      }),
    ]);

  // AI-half scores; neutral fallbacks on AI failure (matches prior behavior).
  const aiAlignment = aiResult.output?.alignment ?? {
    topic_fit: 3,
    differentiator_presence: 3,
    voice_match: 3,
    banned_topics_check: 5,
    notes: {
      topic_fit: "",
      differentiator_presence: "",
      voice_match: "",
      banned_topics_check: "",
    },
  };
  const aiDepth = aiResult.output?.depth ?? {
    originality_vs_serp: 4,
    leverage_of_positioning: 2,
    notes: { originality_vs_serp: "", leverage_of_positioning: "" },
  };
  const aiEeat = aiResult.output?.eeat ?? {
    specificity: 1,
    appropriate_hedging: 1,
    notes: { specificity: "", appropriate_hedging: "" },
  };

  // ─── Combine into final per-sub-score numbers ───────────────

  // Alignment = AI 20 + deterministic cap (non-positive penalty).
  const alignmentAiTotal =
    aiAlignment.topic_fit +
    aiAlignment.differentiator_presence +
    aiAlignment.voice_match +
    aiAlignment.banned_topics_check;
  const alignmentScore = Math.max(0, alignmentAiTotal + alignmentDet.penalty);

  // Depth = deterministic 6 + AI 9.
  const depthAiTotal =
    aiDepth.originality_vs_serp + aiDepth.leverage_of_positioning;
  const depthScore = depthDet.score + depthAiTotal;

  // E-E-A-T = deterministic 6 + AI 4.
  const eeatAiTotal = aiEeat.specificity + aiEeat.appropriate_hedging;
  const eeatScore = eeatDet.score + eeatAiTotal;

  const total =
    alignmentScore +
    seo.score +
    readability.score +
    depthScore +
    structure.score +
    faq.score +
    eeatScore;

  // ─── Collect issues with AI notes appended as low-sev ──────

  const aiAlignmentIssues: ScoreIssue[] = [];
  const flag = (
    key: keyof typeof aiAlignment.notes,
    value: number,
    label: string
  ) => {
    if (value < 4) {
      aiAlignmentIssues.push({
        subScore: "alignment",
        severity: value < 3 ? "med" : "low",
        message: `${label}: ${value}/5 — ${aiAlignment.notes[key] || "see AI notes"}`,
        suggestedFix: `Bring ${label.toLowerCase()} up to 4+.`,
      });
    }
  };
  flag("topic_fit", aiAlignment.topic_fit, "Topic fit");
  flag("differentiator_presence", aiAlignment.differentiator_presence, "Differentiator presence");
  flag("voice_match", aiAlignment.voice_match, "Voice match");

  const aiDepthIssues: ScoreIssue[] = [];
  if (aiDepth.originality_vs_serp < 4) {
    aiDepthIssues.push({
      subScore: "depth",
      severity: "med",
      message: `Originality vs SERP: ${aiDepth.originality_vs_serp}/6 — ${aiDepth.notes.originality_vs_serp || "likely a rehash"}`,
      suggestedFix:
        "Take a specific stance the top 10 don't — new data, new framing, or a counter-point.",
    });
  }
  if (aiDepth.leverage_of_positioning < 2) {
    aiDepthIssues.push({
      subScore: "depth",
      severity: "med",
      message: `Brand POV leverage: ${aiDepth.leverage_of_positioning}/3 — ${aiDepth.notes.leverage_of_positioning || "could be written by anyone"}`,
      suggestedFix:
        "Anchor the argument in your value proposition or differentiators.",
    });
  }

  const aiEeatIssues: ScoreIssue[] = [];
  if (aiEeat.specificity < 2) {
    aiEeatIssues.push({
      subScore: "eeat",
      severity: "low",
      message: `Specificity ${aiEeat.specificity}/2 — ${aiEeat.notes.specificity || "too abstract"}`,
      suggestedFix:
        "Replace generic statements with concrete examples or numbers.",
    });
  }
  if (aiEeat.appropriate_hedging < 2) {
    aiEeatIssues.push({
      subScore: "eeat",
      severity: "low",
      message: `Hedging calibration ${aiEeat.appropriate_hedging}/2 — ${aiEeat.notes.appropriate_hedging || "off"}`,
      suggestedFix:
        "Claim certainty where earned; hedge on projections and trends.",
    });
  }

  const issues = [
    ...alignmentDet.issues,
    ...aiAlignmentIssues,
    ...seo.issues,
    ...readability.issues,
    ...depthDet.issues,
    ...aiDepthIssues,
    ...structure.issues,
    ...faq.issues,
    ...eeatDet.issues,
    ...aiEeatIssues,
    ...aiResult.failureIssues,
  ].sort((a, b) => {
    const sev = rankSeverity(a.severity) - rankSeverity(b.severity);
    if (sev !== 0) return sev;
    return rankSubScore(a.subScore) - rankSubScore(b.subScore);
  });

  return {
    total,
    subScores: {
      alignment: { score: alignmentScore, max: 20 },
      seo: { score: seo.score, max: seo.max },
      readability: { score: readability.score, max: readability.max },
      depth: { score: depthScore, max: 15 },
      structure: { score: structure.score, max: structure.max },
      faq: { score: faq.score, max: faq.max },
      eeat: { score: eeatScore, max: 10 },
    },
    issues,
    aiCostUsd: aiResult.costUsd,
    computedAt: new Date().toISOString(),
  };
}
