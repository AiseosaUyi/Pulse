"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import {
  composeTakeAi,
  composeModes,
  ComposeAiError,
  type ComposeMode,
} from "@/lib/ai/compose-take";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export interface GenerateDraftInput {
  mode: ComposeMode;
  sourceUrl?: string;
  angle?: string;
  focusPlatforms?: string[];
}

export interface SocialDraft {
  id: string;
  mode: string;
  primary_platform: string | null;
  angle: string | null;
  original_text: string;
  x_text: string | null;
  linkedin_text: string | null;
  instagram_text: string | null;
  tiktok_text: string | null;
  youtube_text: string | null;
  hooks_json: string[] | null;
  created_at: string;
}

export async function listSocialDrafts(tenantSlug: string): Promise<SocialDraft[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("social_drafts")
    .select("id, mode, primary_platform, angle, original_text, x_text, linkedin_text, instagram_text, tiktok_text, youtube_text, hooks_json, created_at")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []) as SocialDraft[];
}

export async function deleteDraft(draftId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("social_drafts")
    .delete()
    .eq("id", draftId)
    .eq("created_by", user.id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export interface GeneratedDraft {
  id: string;
  mode: ComposeMode;
  x: string | null;
  linkedin: string | null;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  hooks: string[] | null;
}

export async function generateDraft(
  tenantSlug: string,
  input: GenerateDraftInput
): Promise<ActionResult<{ draft: GeneratedDraft }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  if (!composeModes.includes(input.mode)) {
    return { success: false, error: "Invalid mode" };
  }

  const sourceUrl = input.sourceUrl?.trim() || undefined;
  const angle = input.angle?.trim() || undefined;
  if (!sourceUrl && !angle) {
    return {
      success: false,
      error: "Drop a link or type your take to draft from.",
    };
  }
  if ((angle?.length ?? 0) > 2000) {
    return { success: false, error: "That angle is too long — tighten it up." };
  }

  const { voice, positioning } = await getBrandContext(tenantSlug);

  let generated;
  try {
    generated = await composeTakeAi({
      tenantSlug,
      mode: input.mode,
      voice,
      positioning,
      sourceUrl,
      angle,
      focusPlatforms: input.focusPlatforms ?? null,
    });
  } catch (err) {
    if (err instanceof ComposeAiError) {
      const msg = err.message ?? "";
      if (msg.includes("insufficient_quota") || msg.includes("quota")) {
        return { success: false, error: "AI credits exhausted — top up your OpenAI account at platform.openai.com/settings/billing." };
      }
      if (msg.includes("rate_limit") || msg.includes("429")) {
        return { success: false, error: "AI rate limit hit — wait a moment and try again." };
      }
      return { success: false, error: `Couldn't draft — ${msg || "try again."}` };
    }
    return { success: false, error: "Something went wrong drafting that." };
  }

  const r = generated.result;
  const originalText = r.x ?? r.linkedin ?? r.instagram ?? r.tiktok ?? r.youtube ?? "";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_drafts")
    .insert({
      tenant_slug: tenantSlug,
      mode: input.mode,
      primary_platform: input.focusPlatforms?.[0] ?? null,
      angle: (input.angle?.trim() || input.sourceUrl || originalText).slice(0, 200),
      original_text: originalText,
      source_url: sourceUrl ?? null,
      x_text: r.x ?? null,
      linkedin_text: r.linkedin ?? null,
      instagram_text: r.instagram ?? null,
      tiktok_text: r.tiktok ?? null,
      youtube_text: r.youtube ?? null,
      hooks_json: r.hooks ?? null,
      generator_model: generated.model,
      generator_cost_usd: generated.costUsd,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: "Drafted, but couldn't save it." };
  }

  return {
    success: true,
    draft: {
      id: data.id,
      mode: input.mode,
      x: r.x,
      linkedin: r.linkedin,
      instagram: r.instagram,
      tiktok: r.tiktok,
      youtube: r.youtube,
      hooks: r.hooks,
    },
  };
}
