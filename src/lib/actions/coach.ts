"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { getBlogPostRecord } from "@/lib/services/blog-posts";
import {
  generateCoachActions,
  CoachError,
  type CoachActionDraft,
} from "@/lib/ai/coach";
import type { CoachSourceType, CoachStatus } from "@/lib/types/coach";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

async function persistActions(
  tenantSlug: string,
  sourceType: CoachSourceType,
  sourceId: string | null,
  actions: CoachActionDraft[],
  model: string,
  costUsd: number,
  actionHref: string | null
): Promise<{ inserted: number; error?: string }> {
  if (actions.length === 0) return { inserted: 0 };
  const supabase = await createClient();
  const rows = actions.map((a) => ({
    tenant_slug: tenantSlug,
    source_type: sourceType,
    source_id: sourceId,
    title: a.title,
    description: a.description,
    impact_area: a.impact_area,
    priority: a.priority,
    cta_label: a.cta_label,
    action_href: actionHref,
    generator_model: model,
    generator_cost_usd: costUsd / actions.length,
    created_by_ai: true,
  }));
  const { error, data } = await supabase
    .from("coach_actions")
    .insert(rows)
    .select("id");
  if (error) return { inserted: 0, error: error.message };
  return { inserted: data?.length ?? rows.length };
}

/**
 * Generate actions for a blog post's current score issues.
 */
export async function coachForBlogPost(
  tenantSlug: string,
  blogPostId: string
): Promise<ActionResult<{ inserted: number }>> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  const post = await getBlogPostRecord(tenantSlug, blogPostId);
  if (!post) return { success: false, error: "Blog post not found" };

  // Dedup: skip if this post already has open coach actions from a
  // prior "Ask coach" click. Without this, repeated clicks on an
  // unchanged post regenerate the same issues into fresh actions the
  // LLM phrases 2-3 different ways each time (e.g. three separate
  // "shorten the title" cards), flooding the queue with near-duplicates.
  // Mirrors the dedup insertCoachActionAdmin() already does for the
  // ads-signal cron path.
  const supabase = await createClient();
  const { data: existingOpen } = await supabase
    .from("coach_actions")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("source_type", "blog_score")
    .eq("source_id", blogPostId)
    .in("status", ["pending", "in_progress", "snoozed"])
    .limit(1);
  if (existingOpen && existingOpen.length > 0) {
    return {
      success: false,
      error:
        "Coach already has open actions for this post — resolve or dismiss them before asking again.",
    };
  }

  const { voice, positioning } = await getBrandContext(tenantSlug);

  const scoreLine =
    post.contentScore != null
      ? `Current score: ${post.contentScore}/100 — target is 90.`
      : "No score yet.";
  const issues =
    post.scoreIssues.length > 0
      ? post.scoreIssues
          .map(
            (i, idx) =>
              `${idx + 1}. [${i.severity}/${i.subScore}] ${i.message} → suggested fix: ${i.suggestedFix}`
          )
          .join("\n")
      : "(No specific issues flagged.)";

  const signal = [
    `Blog post: "${post.title}"`,
    `Status: ${post.status}`,
    scoreLine,
    post.targetKeyword ? `Target keyword: ${post.targetKeyword}` : "",
    "",
    "Known issues:",
    issues,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generateCoachActions({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      sourceType: "blog_score",
      signal,
      targetCount: 3,
    });
    const res = await persistActions(
      tenantSlug,
      "blog_score",
      blogPostId,
      result.actions,
      result.model,
      result.costUsd,
      `/seo-tracker/blog-writer/${blogPostId}`
    );
    if (res.error) return { success: false, error: res.error };
    revalidatePath("/dashboard");
    revalidatePath(`/seo-tracker/blog-writer/${blogPostId}`);
    return { success: true, inserted: res.inserted };
  } catch (err) {
    const msg =
      err instanceof CoachError
        ? "Coach generation failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}

/**
 * Generate actions from a freeform prompt (e.g. "ads are underperforming,
 * what should we do?"). Used by the dashboard "Ask coach" flow.
 */
export async function coachForPrompt(
  tenantSlug: string,
  prompt: string
): Promise<ActionResult<{ inserted: number }>> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  if (!prompt.trim()) return { success: false, error: "Prompt is empty" };

  const { voice, positioning } = await getBrandContext(tenantSlug);
  try {
    const result = await generateCoachActions({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      sourceType: "generic",
      signal: prompt,
      targetCount: 3,
    });
    const res = await persistActions(
      tenantSlug,
      "generic",
      null,
      result.actions,
      result.model,
      result.costUsd,
      null
    );
    if (res.error) return { success: false, error: res.error };
    revalidatePath("/dashboard");
    return { success: true, inserted: res.inserted };
  } catch (err) {
    const msg =
      err instanceof CoachError
        ? "Coach generation failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}

export async function updateCoachActionStatus(
  tenantSlug: string,
  id: string,
  status: CoachStatus,
  snoozedUntil?: string | null
): Promise<ActionResult> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "done") patch.completed_at = new Date().toISOString();
  if (status === "snoozed" && snoozedUntil !== undefined) {
    patch.snoozed_until = snoozedUntil;
  }
  if (status !== "snoozed") patch.snoozed_until = null;
  const { error } = await supabase
    .from("coach_actions")
    .update(patch)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteCoachAction(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("coach_actions")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}
