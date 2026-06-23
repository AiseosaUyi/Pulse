"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { fetchHandlePosts } from "@/lib/scrape/social-posts";
import { runBrandAuditAi, type ScrapedSite } from "@/lib/ai/brand-audit";
import { defaultCadenceConfig } from "@/lib/cadence/types";

/**
 * Analyze a user's X/LinkedIn handle to infer their brand voice automatically.
 * Fetches recent posts via Apify, runs the same voice/positioning extraction the
 * brand audit uses, and saves it — replacing the "paste one example" step.
 * Degrades gracefully (returns an error) until a scraper actor id is configured.
 */
export async function analyzeHandle(
  tenantSlug: string,
  input: { platform: "x" | "linkedin"; handle: string; timezone?: string }
): Promise<{ error: string } | void> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const handle = input.handle.trim();
  if (!handle) return { error: "Enter your handle." };

  let fetched;
  try {
    fetched = await fetchHandlePosts(input.platform, handle);
  } catch {
    return { error: "Couldn't reach the post scraper. Paste an example post instead." };
  }
  if (!fetched.configured) {
    return {
      error: "Handle analysis isn't connected yet — paste an example post instead. (Set APIFY_X_ACTOR_ID / APIFY_LINKEDIN_PROFILE_ACTOR_ID to enable.)",
    };
  }
  if (fetched.posts.length === 0) {
    return { error: "Couldn't find recent posts for that handle." };
  }

  const sample = fetched.posts.join("\n\n---\n\n").slice(0, 12_000);
  const site: ScrapedSite = {
    url: `https://${input.platform === "x" ? "x.com" : "linkedin.com/in"}/${handle.replace(/^@/, "")}`,
    title: handle,
    description: `${input.platform} posts by ${handle}`,
    sampleText: sample,
    pagesFetched: [],
  };

  let audit;
  try {
    audit = await runBrandAuditAi(tenantSlug, site);
  } catch {
    return { error: "Couldn't analyze those posts — paste an example instead." };
  }

  const supabase = await createClient();
  const { data: tenant, error: readErr } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (readErr) return { error: readErr.message };

  const existing = (tenant?.settings as Record<string, unknown>) ?? {};
  const { error: writeErr } = await supabase
    .from("tenants")
    .update({
      settings: {
        ...existing,
        brand_voice: audit.voice,
        brand_positioning: audit.positioning,
        cadence: defaultCadenceConfig(input.timezone),
        individual_onboarded: true,
      },
    })
    .eq("slug", tenantSlug);
  if (writeErr) return { error: writeErr.message };

  redirect("/composer");
}
