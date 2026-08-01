"use server";

// Chunked regeneration so the iterate-to-90 loop fits inside the
// Vercel Hobby 60s function cap. The full loop (~100s) is split into
// steps; the client polls `advanceRegeneration` until the phase is
// terminal. Each advance call does ONE AI operation (~20-30s).
//
// State machine:
//
//   (null) ──startRegeneration──► phase: "starting"
//   "starting"       ──advance──► runs initialGenerate + score
//                                 phase: "scored"
//   "scored" (≥90 OR force)
//                     ──advance──► commit + phase: "ok"
//   "scored" (<90, refine < 3)
//                     ──advance──► runs refineContent
//                                 phase: "refine_done"
//   "scored" (<90, refine ≥ 3, !force)
//                     ──advance──► phase: "below_threshold"
//   "refine_done"    ──advance──► runs score + increments refine_count
//                                 phase: "scored"
//
// Terminal phases: "ok" | "below_threshold" | "failed". Client stops
// polling on any of these.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import {
  initialGenerate,
  refineContent,
  buildVoiceBlock,
  BlogGenerationError,
} from "@/lib/ai/generate-blog-post";
import { buildPositioningBlock } from "@/lib/ai/brand-positioning";
import { scoreBlogPost } from "@/lib/ai/score-blog";
import { countWords } from "@/lib/blog/word-count";
import { buildGooglePreview } from "@/lib/blog/google-preview";
import { scanBlogContent, stripBannedDashes } from "@/lib/blog/content-flags";
import type { RegenerationState, BlogScoreIssue } from "@/lib/types/blog-posts";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

const REGEN_MIN_SCORE = 90;
const MAX_REFINE_PASSES = 3;

export interface StartRegenerationInput {
  extraFeedback?: string;
  targetWordCount?: number;
  force?: boolean;
}

/**
 * Kick off a chunked regeneration. Fast (writes state only) —
 * returns the initial phase so the client can start polling
 * advanceRegeneration immediately.
 */
export async function startRegeneration(
  postId: string,
  tenantSlug: string,
  input: StartRegenerationInput = {}
): Promise<ActionResult<{ state: RegenerationState }>> {
  const supabase = await createClient();

  // Fail fast if there's an in-progress regen we'd clobber.
  const { data: existing } = await supabase
    .from("blog_posts")
    .select("regeneration_state, title")
    .eq("id", postId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (!existing) return { success: false, error: "Blog post not found" };
  const prev = existing.regeneration_state as RegenerationState | null;
  if (
    prev &&
    prev.phase !== "ok" &&
    prev.phase !== "below_threshold" &&
    prev.phase !== "failed"
  ) {
    // Another tab is mid-regen. Caller should poll the existing
    // state, not start a new one.
    return { success: true, state: prev };
  }

  const now = new Date().toISOString();
  const initial: RegenerationState = {
    phase: "starting",
    draft: {
      title: (existing.title ?? "") as string,
      meta_description: "",
      outline: [],
      content: "",
      secondary_keywords: [],
    },
    score: null,
    passes: [],
    total_cost_usd: 0,
    refine_count: 0,
    feedback: (input.extraFeedback ?? "").trim(),
    force: input.force === true,
    target_word_count: input.targetWordCount ?? 1200,
    started_at: now,
    updated_at: now,
    error: null,
  };

  const { error } = await supabase
    .from("blog_posts")
    .update({ regeneration_state: initial, generation_status: "generating" })
    .eq("id", postId)
    .eq("tenant_slug", tenantSlug);

  if (error) return { success: false, error: error.message };
  return { success: true, state: initial };
}

/**
 * Run ONE step of the state machine. Client calls this repeatedly
 * until state.phase is terminal. Each call runs AT MOST one AI
 * operation so the total function time stays well under 60s.
 */
export async function advanceRegeneration(
  postId: string,
  tenantSlug: string
): Promise<ActionResult<{ state: RegenerationState }>> {
  const supabase = await createClient();

  const { data: row, error: readErr } = await supabase
    .from("blog_posts")
    .select(
      "id, title, target_keyword, content, content_json, word_count, content_score, generation_meta, regeneration_state"
    )
    .eq("id", postId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (readErr || !row) {
    return { success: false, error: "Blog post not found" };
  }

  const state = row.regeneration_state as RegenerationState | null;
  if (!state) {
    return {
      success: false,
      error: "No regeneration in progress — call startRegeneration first.",
    };
  }

  // Terminal phases: nothing to do, just echo.
  if (
    state.phase === "ok" ||
    state.phase === "below_threshold" ||
    state.phase === "failed"
  ) {
    return { success: true, state };
  }

  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const { voice, positioning } = await getBrandContext(tenantSlug);

  try {
    let nextState: RegenerationState;

    if (state.phase === "starting") {
      nextState = await runInitialThenScore(
        state,
        row,
        tenant.name,
        voice,
        positioning,
        tenantSlug
      );
    } else if (state.phase === "scored") {
      nextState = await handleScored(
        state,
        row,
        tenant.name,
        voice,
        positioning,
        tenantSlug,
        tenant.domain,
        supabase
      );
    } else if (state.phase === "refine_done") {
      nextState = await runScorePass(state, tenantSlug, positioning, voice);
    } else {
      nextState = state;
    }

    // Persist updated state. We skip the update when we already
    // committed (phase "ok" path wrote blog_posts directly + cleared
    // regeneration_state inline).
    if (nextState.phase !== "ok") {
      const { error: updateErr } = await supabase
        .from("blog_posts")
        .update({ regeneration_state: nextState })
        .eq("id", postId)
        .eq("tenant_slug", tenantSlug);
      if (updateErr) {
        return { success: false, error: updateErr.message };
      }
    }

    return { success: true, state: nextState };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed: RegenerationState = {
      ...state,
      phase: "failed",
      error: msg,
      updated_at: new Date().toISOString(),
    };
    await supabase
      .from("blog_posts")
      .update({ regeneration_state: failed, generation_status: "failed" })
      .eq("id", postId)
      .eq("tenant_slug", tenantSlug);
    return { success: false, error: msg };
  }
}

/**
 * Cancel a stuck regeneration. Clears the state so the user can
 * start over or their old draft stops being locked behind a
 * ghost "generating" status.
 */
export async function cancelRegeneration(
  postId: string,
  tenantSlug: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("blog_posts")
    .update({ regeneration_state: null, generation_status: "ready" })
    .eq("id", postId)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ──────────────────────────────────────────────────────────
// Step implementations
// ──────────────────────────────────────────────────────────

type Row = {
  id: string;
  title: string | null;
  target_keyword: string | null;
  content: string | null;
  content_json: unknown | null;
  word_count: number | null;
  content_score: number | null;
  generation_meta: { target_word_count?: number } | null;
  regeneration_state: RegenerationState | null;
};

async function runInitialThenScore(
  state: RegenerationState,
  row: Row,
  tenantName: string,
  voice: Awaited<ReturnType<typeof getBrandContext>>["voice"],
  positioning: Awaited<ReturnType<typeof getBrandContext>>["positioning"],
  tenantSlug: string
): Promise<RegenerationState> {
  const keyword =
    ((row.target_keyword ?? "") as string).trim() ||
    ((row.title ?? "") as string).trim() ||
    "blog";

  const voiceBlock = buildVoiceBlock(voice);
  const positioningBlock = buildPositioningBlock(positioning);

  const gen = await initialGenerate(
    {
      tenantSlug,
      tenantName,
      voice,
      positioning,
      targetKeyword: keyword,
      titleOverride: (row.title ?? undefined) as string | undefined,
      improveTitle: true,
      extraContext: state.feedback || undefined,
      targetWordCount: state.target_word_count,
    },
    state.target_word_count,
    voiceBlock,
    positioningBlock
  );

  const wordCount = countWords(gen.post.content);
  const score = await scoreBlogPost({
    tenantSlug,
    post: {
      title: gen.post.title,
      metaDescription: gen.post.meta_description,
      content: gen.post.content,
      outline: gen.post.outline,
      targetKeyword: keyword,
      secondaryKeywords: gen.post.secondary_keywords,
      targetWordCount: state.target_word_count,
    },
    positioning,
    voice,
  });

  return {
    ...state,
    phase: "scored",
    draft: gen.post,
    score: {
      total: score.total,
      subScores: score.subScores,
      issues: score.issues,
      aiCostUsd: score.aiCostUsd,
      computedAt: score.computedAt,
    },
    passes: [
      ...state.passes,
      {
        pass: state.passes.length + 1,
        kind: "generate",
        word_count: wordCount,
        cost_usd: gen.cost,
        duration_ms: gen.durationMs,
      },
    ],
    total_cost_usd: state.total_cost_usd + gen.cost + score.aiCostUsd,
    updated_at: new Date().toISOString(),
  };
}

/**
 * "scored" branch — decide: commit (≥90 or force), refine (more
 * budget), or reject (no budget left).
 */
async function handleScored(
  state: RegenerationState,
  row: Row,
  tenantName: string,
  voice: Awaited<ReturnType<typeof getBrandContext>>["voice"],
  positioning: Awaited<ReturnType<typeof getBrandContext>>["positioning"],
  tenantSlug: string,
  tenantDomain: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<RegenerationState> {
  if (!state.score) {
    throw new Error("scored phase requires a score — state corrupt");
  }

  const scoreTotal = state.score.total;
  const canAccept = scoreTotal >= REGEN_MIN_SCORE || state.force;
  const outOfBudget = state.refine_count >= MAX_REFINE_PASSES;

  if (canAccept) {
    await commitDraft(state, row, tenantDomain, tenantSlug, supabase);
    return {
      ...state,
      phase: "ok",
      updated_at: new Date().toISOString(),
    };
  }

  if (outOfBudget) {
    // Out of refine budget and score still < 90 without force.
    await supabase
      .from("blog_posts")
      .update({ generation_status: "ready" })
      .eq("id", row.id)
      .eq("tenant_slug", tenantSlug);
    return {
      ...state,
      phase: "below_threshold",
      rejected_score: scoreTotal,
      rejected_issues: (state.score.issues ?? []).slice(0, 5) as BlogScoreIssue[],
      updated_at: new Date().toISOString(),
    };
  }

  // Still budget: run refine. Preserves the in-flight best draft so
  // if this run fails we can at least report the prior score.
  const keyword =
    ((row.target_keyword ?? "") as string).trim() ||
    ((row.title ?? "") as string).trim() ||
    "blog";
  void tenantName; // silence unused — kept in sig for symmetry

  const voiceBlock = buildVoiceBlock(voice);
  const positioningBlock = buildPositioningBlock(positioning);

  const r = await refineContent({
    input: {
      tenantSlug,
      tenantName,
      voice,
      positioning,
      targetKeyword: keyword,
      extraContext: state.feedback || undefined,
      targetWordCount: state.target_word_count,
    },
    current: state.draft,
    currentScore: scoreTotal,
    issues: state.score.issues,
    voiceBlock,
    positioningBlock,
  });

  const wordCount = countWords(r.post.content);
  return {
    ...state,
    phase: "refine_done",
    draft: r.post,
    score: null,
    passes: [
      ...state.passes,
      {
        pass: state.passes.length + 1,
        kind: "refine",
        word_count: wordCount,
        cost_usd: r.cost,
        duration_ms: r.durationMs,
      },
    ],
    total_cost_usd: state.total_cost_usd + r.cost,
    refine_count: state.refine_count + 1,
    updated_at: new Date().toISOString(),
  };
}

async function runScorePass(
  state: RegenerationState,
  tenantSlug: string,
  positioning: Awaited<ReturnType<typeof getBrandContext>>["positioning"],
  voice: Awaited<ReturnType<typeof getBrandContext>>["voice"]
): Promise<RegenerationState> {
  const score = await scoreBlogPost({
    tenantSlug,
    post: {
      title: state.draft.title,
      metaDescription: state.draft.meta_description,
      content: state.draft.content,
      outline: state.draft.outline,
      targetKeyword: null,
      secondaryKeywords: state.draft.secondary_keywords,
      targetWordCount: state.target_word_count,
    },
    positioning,
    voice,
  });

  return {
    ...state,
    phase: "scored",
    score: {
      total: score.total,
      subScores: score.subScores,
      issues: score.issues,
      aiCostUsd: score.aiCostUsd,
      computedAt: score.computedAt,
    },
    total_cost_usd: state.total_cost_usd + score.aiCostUsd,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Persist the accepted draft to blog_posts + write pre/post-snapshot
 * version rows + clear regeneration_state. Mirrors what the sync
 * regenerateBlogPost did pre-chunking.
 */
async function commitDraft(
  state: RegenerationState,
  row: Row,
  tenantDomain: string,
  tenantSlug: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  const user = await getCurrentUser();
  const { voice: voiceForFlags } = await getBrandContext(tenantSlug);
  const draft = {
    ...state.draft,
    content: stripBannedDashes(state.draft.content, voiceForFlags),
  };
  const finalWordCount = countWords(draft.content);
  const contentFlags = scanBlogContent(draft.content, voiceForFlags);

  const googlePreview = buildGooglePreview({
    title: draft.title,
    metaDescription: draft.meta_description,
    slug: null,
    tenantDomain,
  });

  // Archive old content.
  const { data: lastVersion } = await supabase
    .from("blog_post_versions")
    .select("version_number")
    .eq("blog_post_id", row.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion =
    ((lastVersion?.version_number as number | undefined) ?? 0) + 1;

  await supabase.from("blog_post_versions").insert({
    blog_post_id: row.id,
    tenant_slug: tenantSlug,
    version_number: nextVersion,
    content_json: row.content_json ?? null,
    content_markdown: (row.content ?? "") as string,
    word_count: (row.word_count ?? 0) as number,
    content_score: (row.content_score ?? null) as number | null,
    diff_summary: state.feedback
      ? "Pre-regenerate snapshot (with feedback)"
      : "Pre-regenerate snapshot",
    created_by: user?.id ?? null,
  });

  const scoreWarning = state.score && state.score.total < REGEN_MIN_SCORE;
  const meta = {
    passes: state.passes,
    target_word_count: state.target_word_count,
    final_word_count: finalWordCount,
    stopped_reason: "score_target_hit",
    total_cost_usd: state.total_cost_usd,
    final_score: state.score?.total,
    score_warning: !!scoreWarning,
  };

  const { error: updateErr } = await supabase
    .from("blog_posts")
    .update({
      title: draft.title,
      secondary_keywords: draft.secondary_keywords,
      meta_description: draft.meta_description,
      outline: draft.outline,
      content: draft.content,
      content_json: null,
      word_count: finalWordCount,
      generation_meta: meta,
      google_preview: googlePreview,
      content_score: state.score?.total ?? null,
      sub_scores: state.score?.subScores ?? null,
      score_issues: state.score?.issues ?? [],
      score_warning: !!scoreWarning,
      content_flags: contentFlags,
      content_flags_cleared: false,
      regeneration_state: null,
      generation_status: "ready",
    })
    .eq("id", row.id)
    .eq("tenant_slug", tenantSlug);

  if (updateErr) throw new Error(updateErr.message);

  await supabase.from("blog_post_versions").insert({
    blog_post_id: row.id,
    tenant_slug: tenantSlug,
    version_number: nextVersion + 1,
    content_json: null,
    content_markdown: draft.content,
    word_count: finalWordCount,
    content_score: state.score?.total ?? null,
    diff_summary: state.feedback
      ? `Regenerated with feedback: "${state.feedback.slice(0, 80)}${state.feedback.length > 80 ? "…" : ""}"`
      : "Regenerated (no feedback)",
    created_by: user?.id ?? null,
  });

  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath(`/seo-tracker/blog-writer/${row.id}`);
}

// Keep BlogGenerationError in the callers' surface so catch blocks
// can type-narrow. Re-exported for ergonomics.
export { BlogGenerationError };
