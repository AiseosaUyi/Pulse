"use server";

// Approval state machine for SEO blog posts (blog_posts table, the
// editor's backing store). Every transition flows through the
// transition_blog_post_status RPC (defined in 044), which does the
// optimistic version check + audit row insert in one transaction. This
// prevents the "two reviewers approve simultaneously" race called out
// in eng review §A3.
//
// Callers (UI server actions) pass the expectedVersion they loaded
// alongside the post. A version_conflict means another writer beat us
// to the punch — surface a friendly refresh prompt rather than an error.
//
// State diagram (mirrors blog_posts_status_check in 043):
//
//   draft ──submit──▶ in_review ──approve──▶ seo_approved
//      ▲                 │                       │
//      └─request_changes─┘                       ├─schedule
//                                                ▼      ▼
//                                           scheduled  publishing
//                                                       │
//   publish_failed ◀──fail── publishing ◀────retry──────┤
//      │                         │                      │
//      └─give_up/edit ▶ draft    └─success──▶ published │
//                                                  │    │
//                                              archived ◀ (admin only)

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, getCurrentTenant } from "@/lib/auth";

export type ApprovalActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string; reason?: ApprovalErrorReason };

export type ApprovalErrorReason =
  | "not_found"
  | "forbidden"
  | "invalid_transition"
  | "version_conflict"
  | "unknown";

interface TransitionArgs {
  postId: string;
  fromStatus: string;
  toStatus: string;
  expectedVersion: number;
  reason?: string;
}

async function callTransition(args: TransitionArgs): Promise<
  ApprovalActionResult<{ status: string; version: number }>
> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("transition_blog_post_status", {
    p_post_id: args.postId,
    p_from_status: args.fromStatus,
    p_to_status: args.toStatus,
    p_expected_version: args.expectedVersion,
    p_actor: user.id,
    p_reason: args.reason ?? null,
  });

  if (error) {
    return mapTransitionError(error);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.new_status) {
    return { success: false, error: "Empty RPC response", reason: "unknown" };
  }

  // Cache invalidation: the blog-writer page, the pipeline list, and
  // the dashboard all surface status — bust them all.
  revalidatePath("/seo-tracker/blog-writer/[id]", "page");
  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath("/content-vault/pipeline");

  return {
    success: true,
    status: row.new_status as string,
    version: row.new_version as number,
  };
}

function mapTransitionError<T>(err: {
  code?: string;
  message?: string;
}): ApprovalActionResult<T> {
  const msg = err.message ?? "Unknown error";
  if (msg.includes("post_not_found")) {
    return { success: false, error: "Blog post not found", reason: "not_found" };
  }
  if (msg.includes("forbidden")) {
    return {
      success: false,
      error: "You don't have permission for this transition",
      reason: "forbidden",
    };
  }
  if (msg.includes("invalid_transition")) {
    return {
      success: false,
      error: "That transition isn't allowed from the current status",
      reason: "invalid_transition",
    };
  }
  if (msg.includes("version_conflict")) {
    return {
      success: false,
      error: "Post changed since you opened it — refresh and try again",
      reason: "version_conflict",
    };
  }
  return { success: false, error: msg, reason: "unknown" };
}

// ─── Public action API ─────────────────────────────────────────

export async function submitForReview(
  postId: string,
  expectedVersion: number,
  currentStatus: "draft" | "editing" | "review"
) {
  return callTransition({
    postId,
    fromStatus: currentStatus,
    toStatus: "in_review",
    expectedVersion,
  });
}

export async function approvePost(
  postId: string,
  expectedVersion: number,
  comment?: string
) {
  return callTransition({
    postId,
    fromStatus: "in_review",
    toStatus: "seo_approved",
    expectedVersion,
    reason: comment,
  });
}

export async function requestChanges(
  postId: string,
  expectedVersion: number,
  comment: string
) {
  if (!comment.trim()) {
    return {
      success: false as const,
      error: "Please tell the author what needs to change",
      reason: "invalid_transition" as const,
    };
  }
  return callTransition({
    postId,
    fromStatus: "in_review",
    toStatus: "draft",
    expectedVersion,
    reason: comment,
  });
}

export async function schedulePost(
  postId: string,
  expectedVersion: number,
  scheduledAt: string
) {
  const supabase = await createClient();
  // Two writes: schedule transition + scheduled_at column. Update
  // scheduled_at first; if the transition fails we leave a stale
  // scheduled_at but the status stays seo_approved — manual cleanup
  // is straightforward (clear the column).
  const { error: updateErr } = await supabase
    .from("blog_posts")
    .update({ scheduled_at: scheduledAt })
    .eq("id", postId);
  if (updateErr) {
    return {
      success: false as const,
      error: updateErr.message,
      reason: "unknown" as const,
    };
  }
  return callTransition({
    postId,
    fromStatus: "seo_approved",
    toStatus: "scheduled",
    expectedVersion,
  });
}

export async function retryPublish(postId: string, expectedVersion: number) {
  return callTransition({
    postId,
    fromStatus: "publish_failed",
    toStatus: "publishing",
    expectedVersion,
    reason: "manual retry",
  });
}

export async function unpublishToDraft(
  postId: string,
  expectedVersion: number,
  reason: string
) {
  return callTransition({
    postId,
    fromStatus: "publish_failed",
    toStatus: "draft",
    expectedVersion,
    reason,
  });
}

export async function archivePost(
  postId: string,
  expectedVersion: number,
  reason?: string
) {
  return callTransition({
    postId,
    fromStatus: "published",
    toStatus: "archived",
    expectedVersion,
    reason,
  });
}

export async function unpublishPublishedArticle(
  postId: string,
  reason: string
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };

  const admin = createAdminClient();
  const { data: post, error: fetchErr } = await admin
    .from("blog_posts")
    .select("id, tenant_slug, status, contentful_entry_id")
    .eq("id", postId)
    .maybeSingle();

  if (fetchErr || !post) return { success: false, error: "Article not found" };
  if (post.tenant_slug !== tenant.slug) return { success: false, error: "Tenant mismatch" };

  const { error: updateErr } = await admin
    .from("blog_posts")
    .update({
      status: "draft",
      unpublished_at: new Date().toISOString(),
      unpublished_by: user.id,
      unpublish_reason: reason,
    })
    .eq("id", postId);

  if (updateErr) return { success: false, error: updateErr.message };

  revalidatePath("/seo-tracker/blog-writer");
  revalidatePath(`/seo-tracker/blog-writer/${postId}`);
  return { success: true };
}
