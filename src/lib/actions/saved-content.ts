"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SavedContentStatus } from "@/lib/types/saved-content";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

interface SaveInput {
  title: string;
  sourcePlatform?: string | null;
  sourceUrl?: string | null;
  intelCardId?: string | null;
  trendScoutId?: string | null;
  thumbnailEmoji?: string | null;
  notes?: string | null;
  tags?: string[];
  bestFor?: string[];
}

export async function saveContent(
  tenantSlug: string,
  input: SaveInput
): Promise<ActionResult<{ id: string }>> {
  const title = input.title?.trim();
  if (!title) return { success: false, error: "Title is required" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_content")
    .insert({
      tenant_slug: tenantSlug,
      title,
      source_platform: input.sourcePlatform ?? null,
      source_url: input.sourceUrl ?? null,
      intel_card_id: input.intelCardId ?? null,
      trend_scout_id: input.trendScoutId ?? null,
      thumbnail_emoji: input.thumbnailEmoji ?? null,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      best_for: input.bestFor ?? [],
      status: "new",
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };
  revalidatePath("/content-vault");
  return { success: true, id: data.id };
}

export async function saveContentFromUrl(
  tenantSlug: string,
  url: string
): Promise<ActionResult<{ id: string }>> {
  const trimmed = url.trim();
  if (!trimmed) return { success: false, error: "URL is required" };

  let platform: string | null = null;
  let title = "Saved link";
  try {
    const u = new URL(trimmed);
    const host = u.hostname.replace(/^www\./, "");
    if (host.includes("tiktok.com")) platform = "tiktok";
    else if (host.includes("instagram.com")) platform = "instagram";
    else if (host.includes("twitter.com") || host.includes("x.com")) platform = "twitter";
    else if (host.includes("youtube.com") || host.includes("youtu.be")) platform = "youtube";
    else platform = "manual";
    title = u.pathname.replace(/^\/+/, "").split("/").slice(0, 3).join(" · ") || host;
  } catch {
    return { success: false, error: "Not a valid URL" };
  }

  return saveContent(tenantSlug, {
    title,
    sourcePlatform: platform,
    sourceUrl: trimmed,
    thumbnailEmoji: platform === "tiktok" ? "🎵" : platform === "instagram" ? "📸" : "🔗",
  });
}

export async function updateSavedContentStatus(
  tenantSlug: string,
  id: string,
  status: SavedContentStatus
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("saved_content")
    .update({ status })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/content-vault");
  return { success: true };
}

export async function deleteSavedContent(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("saved_content")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/content-vault");
  return { success: true };
}
