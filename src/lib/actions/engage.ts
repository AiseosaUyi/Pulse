"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getBrandContext, getBrandPositioning } from "@/lib/ai/brand-positioning";
import { draftEngagementAi, EngageAiError } from "@/lib/ai/engage";
import { searchPosts } from "@/lib/scrape/social-posts";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function draftEngagement(
  tenantSlug: string,
  input: { postText: string; fromHandle?: string }
): Promise<ActionResult<{ quote: string; reply: string }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const postText = input.postText.trim();
  if (!postText) return { success: false, error: "Paste the post you want to engage with." };
  if (postText.length > 4000) return { success: false, error: "That post is too long." };

  const { voice, positioning } = await getBrandContext(tenantSlug);
  try {
    const { result } = await draftEngagementAi({
      tenantSlug,
      voice,
      positioning,
      postText,
      fromHandle: input.fromHandle?.trim() || null,
    });
    return { success: true, quote: result.quote, reply: result.reply };
  } catch (err) {
    if (err instanceof EngageAiError) return { success: false, error: "Couldn't draft — try again." };
    return { success: false, error: "Something went wrong." };
  }
}

/**
 * Discover posts worth engaging with, by searching the user's topics on X/LinkedIn
 * via Apify. Degrades gracefully when no scraper actor is configured.
 */
export async function discoverEngageCandidates(
  tenantSlug: string
): Promise<ActionResult<{ found: number }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const positioning = await getBrandPositioning(tenantSlug);
  const topics = positioning?.topics_to_cover ?? [];
  if (topics.length === 0) {
    return { success: false, error: "Add the topics you post about (in setup) so we know what to look for." };
  }

  const found: Array<{ platform: "x" | "linkedin"; handle: string | null; content: string; url: string | null }> = [];
  for (const platform of ["x", "linkedin"] as const) {
    let res;
    try {
      res = await searchPosts(platform, topics);
    } catch {
      continue;
    }
    if (res.configured) found.push(...res.posts.map((p) => ({ platform, ...p })));
  }

  if (found.length === 0) {
    return {
      success: false,
      error: "Auto-discovery isn't connected yet — set APIFY_X_ACTOR_ID / APIFY_LINKEDIN_SEARCH_ACTOR_ID to find posts. You can still paste a post below.",
    };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("engage_candidates")
    .select("content")
    .eq("tenant_slug", tenantSlug);
  const seen = new Set((existing ?? []).map((e) => e.content as string));

  const rows = found
    .filter((r) => !seen.has(r.content))
    .slice(0, 40)
    .map((r) => ({
      tenant_slug: tenantSlug,
      platform: r.platform,
      author_handle: r.handle,
      content: r.content,
      external_url: r.url,
      source_query: topics.slice(0, 5).join(", "),
    }));

  if (rows.length === 0) return { success: true, found: 0 };

  const { error } = await supabase.from("engage_candidates").insert(rows);
  if (error) return { success: false, error: error.message };

  revalidatePath("/engage");
  return { success: true, found: rows.length };
}

export async function dismissCandidate(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("engage_candidates")
    .update({ dismissed: true })
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/engage");
  return { success: true };
}
