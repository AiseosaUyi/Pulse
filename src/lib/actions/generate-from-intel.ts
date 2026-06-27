"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCadenceConfig } from "@/lib/cadence/config";
import { generatePostsFromIntel } from "@/lib/ai/generate-from-intel";

export async function generateAndSaveFromIntel(
  tenantSlug: string
): Promise<{ created: number; error?: string }> {
  try {
    const suggestions = await generatePostsFromIntel(tenantSlug);
    if (!suggestions.length) {
      return { created: 0, error: "No competitor signals found in the last 30 days." };
    }

    const cadence = await getCadenceConfig(tenantSlug);
    const now = new Date();

    const admin = createAdminClient();
    let created = 0;

    for (const post of suggestions) {
      // Base date = today + suggested_day_offset
      const postDate = new Date(now);
      postDate.setDate(postDate.getDate() + (post.suggested_day_offset ?? 0));

      // Pick a posting time: use cadence window if available, else noon UTC
      let hour = 12;
      let minute = 0;
      if (cadence?.windows?.length) {
        const matchingWindow = cadence.windows.find(
          (w) =>
            (w.platform === "x" || w.platform === "linkedin") &&
            w.days.includes(postDate.getDay())
        );
        if (matchingWindow) {
          const [h, m] = matchingWindow.time.split(":").map(Number);
          hour = h ?? 12;
          minute = m ?? 0;
        }
      }
      postDate.setUTCHours(hour, minute, 0, 0);

      // Map platform: 'x' maps to 'x', otherwise pass through
      const platform = post.platform === "x" ? "x" : post.platform;
      const validPlatforms = ["x", "linkedin", "instagram", "tiktok", "youtube"] as const;
      if (!validPlatforms.includes(platform as (typeof validPlatforms)[number])) continue;

      // Build content: caption + image guidance block
      const imageBlock =
        post.image_search_query || post.shoot_direction
          ? [
              "",
              "---",
              post.image_search_query ? `📸 Stock image: ${post.image_search_query}` : null,
              post.shoot_direction ? `🎬 Shoot direction: ${post.shoot_direction}` : null,
            ]
              .filter(Boolean)
              .join("\n")
          : "";

      const content = `${post.caption}${imageBlock}`;

      const { error } = await admin.from("scheduled_posts").insert({
        tenant_slug: tenantSlug,
        platform,
        content,
        media_paths: [],
        scheduled_for: postDate.toISOString(),
        status: "draft",
        source: "ai-content",
      });

      if (!error) created++;
    }

    return { created };
  } catch (err) {
    return {
      created: 0,
      error: err instanceof Error ? err.message : "Generation failed",
    };
  }
}
