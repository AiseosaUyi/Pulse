import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import {
  composeTakeAi,
  composeModes,
  ComposeAiError,
  type ComposeMode,
} from "@/lib/ai/compose-take";

export interface ComposeAndSaveInput {
  mode: ComposeMode;
  sourceUrl?: string;
  angle?: string;
  focusPlatforms?: string[];
}

export interface ComposedDraft {
  id: string;
  mode: ComposeMode;
  x: string | null;
  linkedin: string | null;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  hooks: string[] | null;
}

/** Client-injected twin of generateDraft() (actions/compose.ts) — that
 * file is `"use server"`, so its exports can't take a SupabaseClient
 * param. Duplicates its exact logic (mode/sourceUrl-or-angle validation,
 * composeTakeAi() call, social_drafts insert), attributing created_by to
 * the API token's owner instead of getCurrentUser()'s session. AI-writing
 * (real gpt-4.1 call), not free to test. */
export async function composeAndSaveApi(
  client: SupabaseClient,
  tenantSlug: string,
  createdBy: string | null,
  input: ComposeAndSaveInput
): Promise<{ draft: ComposedDraft } | { error: string }> {
  if (!composeModes.includes(input.mode)) {
    return { error: "Invalid mode" };
  }

  const sourceUrl = input.sourceUrl?.trim() || undefined;
  const angle = input.angle?.trim() || undefined;
  if (!sourceUrl && !angle) {
    return { error: "Provide a sourceUrl or an angle to draft from." };
  }
  if ((angle?.length ?? 0) > 2000) {
    return { error: "That angle is too long — tighten it up." };
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
        return { error: "AI credits exhausted — top up your OpenAI account." };
      }
      if (msg.includes("rate_limit") || msg.includes("429")) {
        return { error: "AI rate limit hit — wait a moment and try again." };
      }
      return { error: `Couldn't draft — ${msg || "try again."}` };
    }
    return { error: "Something went wrong drafting that." };
  }

  const r = generated.result;
  const originalText = r.x ?? r.linkedin ?? r.instagram ?? r.tiktok ?? r.youtube ?? "";

  const { data, error } = await client
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
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: "Drafted, but couldn't save it." };
  }

  return {
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
