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
    });
  } catch (err) {
    if (err instanceof ComposeAiError) {
      return { success: false, error: "Couldn't draft — try again." };
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
      original_text: originalText,
      source_url: sourceUrl ?? null,
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
