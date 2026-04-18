"use server";

import { revalidatePath } from "next/cache";
import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  buildPositioningBlock,
  getBrandContext,
} from "@/lib/ai/brand-positioning";
import { buildVoiceBlock } from "@/lib/ai/generate-blog-post";
import { loadPrompt, renderTemplate } from "@/lib/ai/prompts";
import { estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { saveBlogContent } from "@/lib/actions/blog-versions";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

const AUDIO_BUCKET = "blog-feedback-audio";
const MODEL = "gpt-4.1";
const MODEL_ID = `openai/${MODEL}`;

export interface SubmitFeedbackInput {
  postId: string;
  tenantSlug: string;
  feedbackText?: string;
  /** Path inside the `blog-feedback-audio` bucket. Client uploads
   *  directly via supabase-js; server downloads to transcribe. */
  feedbackAudioPath?: string;
  sourceVersionId?: string;
}

export async function submitFeedback(
  input: SubmitFeedbackInput
): Promise<ActionResult<{ feedbackId: string; transcription: string | null }>> {
  const text = input.feedbackText?.trim();
  const audioPath = input.feedbackAudioPath?.trim();

  if (!text && !audioPath) {
    return {
      success: false,
      error: "Feedback requires either text or an audio recording.",
    };
  }

  const supabase = await createClient();
  const user = await getCurrentUser();

  // Transcribe audio up-front so the row ships with the transcription
  // and the apply step doesn't have to re-download.
  let transcription: string | null = null;
  if (audioPath) {
    const { data: file, error: dlErr } = await supabase.storage
      .from(AUDIO_BUCKET)
      .download(audioPath);
    if (dlErr || !file) {
      return {
        success: false,
        error: `Could not read audio: ${dlErr?.message ?? "not found"}`,
      };
    }
    try {
      const t = await transcribeAudio({
        audio: file,
        filename: audioPath.split("/").pop() ?? "audio.webm",
        tenantSlug: input.tenantSlug,
      });
      transcription = t.text.trim() || null;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Transcription failed",
      };
    }
  }

  const { data, error } = await supabase
    .from("blog_post_feedback")
    .insert({
      blog_post_id: input.postId,
      tenant_slug: input.tenantSlug,
      feedback_text: text ?? null,
      feedback_audio_path: audioPath ?? null,
      transcription,
      source_version_id: input.sourceVersionId ?? null,
      status: "pending",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath("/seo-tracker/blog-writer");
  return { success: true, feedbackId: data.id as string, transcription };
}

/**
 * Edit user-supplied transcription. Whisper can mishear; we let the
 * user tweak before applying. Locked once status ≠ pending.
 */
export async function updateFeedbackTranscription(
  feedbackId: string,
  tenantSlug: string,
  transcription: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("blog_post_feedback")
    .update({ transcription })
    .eq("id", feedbackId)
    .eq("tenant_slug", tenantSlug)
    .eq("status", "pending");
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Apply pending feedback to the current draft. Calls gpt-4.1 with the
 * feedback + brand context + current content; persists the result as
 * a new version (via saveBlogContent); marks feedback row as applied.
 */
export async function applyFeedback(
  feedbackId: string,
  tenantSlug: string
): Promise<
  ActionResult<{
    versionId: string;
    versionNumber: number;
    diffSummary: string;
  }>
> {
  const supabase = await createClient();

  const { data: fb, error: fbErr } = await supabase
    .from("blog_post_feedback")
    .select("*")
    .eq("id", feedbackId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (fbErr || !fb) return { success: false, error: "Feedback not found" };
  if (fb.status !== "pending") {
    return { success: false, error: `Feedback already ${fb.status}` };
  }

  const feedbackBody =
    (fb.transcription as string | null)?.trim() ||
    (fb.feedback_text as string | null)?.trim();
  if (!feedbackBody) {
    return { success: false, error: "Feedback is empty" };
  }

  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select("id, title, meta_description, content")
    .eq("id", fb.blog_post_id)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (postErr || !post) {
    return { success: false, error: "Blog post not found" };
  }

  const { voice, positioning } = await getBrandContext(tenantSlug);
  const prompt = loadPrompt("blog/apply-feedback");

  const userText = renderTemplate(prompt.userTemplate, {
    feedback_text: feedbackBody,
    voice_block: buildVoiceBlock(voice),
    positioning_block: buildPositioningBlock(positioning),
    current_content: (post.content ?? "") as string,
  });

  const applySchema = z.object({
    revised_content: z.string().min(50),
    diff_summary: z.string().min(1).max(400),
  });

  const started = Date.now();
  let revised: z.infer<typeof applySchema>;
  try {
    const result = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: applySchema }),
      system: prompt.system,
      prompt: userText,
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const meta = (result.providerMetadata?.openai ?? {}) as {
      cachedPromptTokens?: number;
    };
    const cacheRead = meta.cachedPromptTokens ?? 0;
    const cost = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: cacheRead,
    });

    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "blog_apply_feedback",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: cacheRead,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    revised = result.output;
  } catch (err) {
    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "blog_apply_feedback",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "AI call failed",
    };
  }

  // Persist the revised content as a new version.
  // contentJson stays null here — the editor will lazily regenerate it
  // from the revised markdown next time it opens the post.
  const save = await saveBlogContent(fb.blog_post_id as string, tenantSlug, {
    content: revised.revised_content,
    contentJson: null,
    diffSummary: revised.diff_summary,
    rescore: true,
  });

  if (!save.success) return save;

  await supabase
    .from("blog_post_feedback")
    .update({
      status: "applied",
      resulting_version_id: save.versionId,
      applied_at: new Date().toISOString(),
    })
    .eq("id", feedbackId)
    .eq("tenant_slug", tenantSlug);

  revalidatePath("/seo-tracker/blog-writer");
  return {
    success: true,
    versionId: save.versionId,
    versionNumber: save.versionNumber,
    diffSummary: revised.diff_summary,
  };
}

export async function rejectFeedback(
  feedbackId: string,
  tenantSlug: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("blog_post_feedback")
    .update({ status: "rejected" })
    .eq("id", feedbackId)
    .eq("tenant_slug", tenantSlug)
    .eq("status", "pending");
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker/blog-writer");
  return { success: true };
}

/**
 * Generate a signed upload URL so the browser can push audio straight
 * to Supabase Storage without the payload round-tripping through our
 * server. The bucket must exist (see Phase D migration notes).
 */
export async function createFeedbackUploadTarget(
  postId: string,
  tenantSlug: string
): Promise<
  ActionResult<{ path: string; uploadUrl: string; token: string }>
> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not signed in" };

  const supabase = await createClient();

  // Cheap tenant-membership check via blog_posts (RLS gates the read).
  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select("id")
    .eq("id", postId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (postErr || !post) {
    return { success: false, error: "Blog post not found" };
  }

  const filename = `${crypto.randomUUID()}.webm`;
  const path = `${tenantSlug}/${postId}/${filename}`;

  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? "Could not create upload URL",
    };
  }

  return {
    success: true,
    path,
    uploadUrl: data.signedUrl,
    token: data.token,
  };
}
