// Slug generation — for blog post URLs. Collision resolver appends
// -2, -3, ... when the generated slug already exists for the tenant.

import { createClient } from "@/lib/supabase/server";

const MAX_SLUG_LENGTH = 75;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['"`]/g, "") // drop apostrophes/quotes before hyphen-folding
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
}

/**
 * Generate a tenant-unique slug from a seed string (usually the post
 * title). If `seed` slugifies to the empty string (e.g. emoji-only
 * title) we fall back to a short random token.
 */
export async function uniqueSlugFor(
  tenantSlug: string,
  seed: string,
  excludePostId?: string
): Promise<string> {
  let base = slugify(seed);
  if (!base) {
    // Unlikely but possible — fall back to a short random slug.
    base = `post-${Math.random().toString(36).slice(2, 8)}`;
  }

  const supabase = await createClient();
  // Try `base`, `base-2`, `base-3`, … until we find an unused one.
  // Cap at 99 attempts; if the user has >99 posts with the same seed
  // they can rename manually.
  for (let n = 0; n < 99; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    let query = supabase
      .from("blog_posts")
      .select("id")
      .eq("tenant_slug", tenantSlug)
      .eq("slug", candidate)
      .limit(1);
    if (excludePostId) query = query.neq("id", excludePostId);
    const { data } = await query;
    if (!data || data.length === 0) return candidate;
  }
  // Ran out of suffixes — return a random-tagged one.
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
