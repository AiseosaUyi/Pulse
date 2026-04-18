import { createClient } from "@/lib/supabase/server";
import type { RegenerationState } from "@/lib/types/blog-posts";

/**
 * Read the in-progress regeneration state for a post. Returns null
 * when no regeneration is running. Same caller-side ergonomics as
 * the other `list*` / `get*` services.
 */
export async function getRegenerationState(
  tenantSlug: string,
  postId: string
): Promise<RegenerationState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .select("regeneration_state")
    .eq("tenant_slug", tenantSlug)
    .eq("id", postId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.regeneration_state ?? null) as RegenerationState | null;
}
