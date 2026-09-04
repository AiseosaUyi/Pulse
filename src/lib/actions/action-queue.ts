"use server";

// Write path for the dashboard's Action Queue UI. Mirrors
// inbound-messages.ts's assignConversation/setConversationStatus shape:
// session-scoped createClient() (not admin), so RLS is a real second fence
// for the in-app UI too — not just the group-filtering the page does for a
// support-role viewer.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import {
  setProposedReply,
  setQueueStatus,
  setPriority,
  setDueAt,
  type RowRef,
  type QueuePriority,
  type QueueStatus,
} from "@/lib/services/action-queue";
import { logQueueActivity, listQueueActivityForRow, type QueueActivityAction, type QueueActivityEntry } from "@/lib/services/queue-activity";
import { draftProspectDm } from "@/lib/actions/outbound";

type ActionResult = { success: true } | { success: false; error: string };

async function withContext(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; tenantSlug: string; userId: string } | { error: string }> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No tenant selected" };
  const supabase = await createClient();
  return { supabase, tenantSlug: tenant.slug, userId: user.id };
}

export async function saveProposedReply(rowRef: RowRef, text: string): Promise<ActionResult> {
  const ctx = await withContext();
  if ("error" in ctx) return { success: false, error: ctx.error };
  const result = await setProposedReply(ctx.supabase, ctx.tenantSlug, rowRef, { text, author: "human" });
  if (!result.ok) return { success: false, error: result.error ?? "Couldn't save" };
  revalidatePath("/dashboard");
  return { success: true };
}

const STATUS_TO_ACTIVITY: Record<QueueStatus, QueueActivityAction | null> = {
  resolved: "resolved",
  open: "reopened",
  dismissed: "dismissed",
  snoozed: "snoozed",
};

export async function setRowStatus(
  rowRef: RowRef,
  status: QueueStatus,
  opts?: { resolutionNote?: string; snoozedUntil?: string; contentSnapshot?: string }
): Promise<ActionResult> {
  const ctx = await withContext();
  if ("error" in ctx) return { success: false, error: ctx.error };
  const result = await setQueueStatus(ctx.supabase, ctx.tenantSlug, rowRef, {
    status,
    resolutionNote: opts?.resolutionNote,
    snoozedUntil: opts?.snoozedUntil,
    resolvedBy: ctx.userId,
  });
  if (!result.ok) return { success: false, error: result.error ?? "Couldn't update" };

  const activityAction = STATUS_TO_ACTIVITY[status];
  if (activityAction) {
    await logQueueActivity(ctx.supabase, ctx.tenantSlug, {
      rowSource: rowRef.source,
      rowId: rowRef.id,
      action: activityAction,
      actorId: ctx.userId,
      contentSnapshot: opts?.contentSnapshot,
    });
  }

  revalidatePath("/dashboard");
  return { success: true };
}

/** Fire-and-forget: View/Copy reply aren't state changes, just observability. */
export async function logRowActivity(
  rowRef: RowRef,
  action: "opened" | "copied_reply",
  contentSnapshot?: string
): Promise<void> {
  const ctx = await withContext();
  if ("error" in ctx) return;
  await logQueueActivity(ctx.supabase, ctx.tenantSlug, {
    rowSource: rowRef.source,
    rowId: rowRef.id,
    action,
    actorId: ctx.userId,
    contentSnapshot,
  });
}

/** Owner/admin only — RLS on queue_activity_log enforces this; a member's
 * session client gets an empty result, not an error. */
export async function getRowActivity(rowRef: RowRef): Promise<QueueActivityEntry[]> {
  const ctx = await withContext();
  if ("error" in ctx) return [];
  return listQueueActivityForRow(ctx.supabase, ctx.tenantSlug, rowRef.source, rowRef.id);
}

export async function setRowPriority(rowRef: RowRef, priority: QueuePriority): Promise<ActionResult> {
  const ctx = await withContext();
  if ("error" in ctx) return { success: false, error: ctx.error };
  const result = await setPriority(ctx.supabase, ctx.tenantSlug, rowRef, priority);
  if (!result.ok) return { success: false, error: "Couldn't update priority" };
  revalidatePath("/dashboard");
  return { success: true };
}

const FINAL_ATTEMPT_CONTEXT =
  "This lead has gone cold with no reply. Write a brief, low-pressure final check-in — not a pitch, not guilt-tripping about the silence. If there's no reply this time, we let it go.";

/** Going Cold's bulk action — reuses the existing AI DM drafting path
 * (draftProspectDm, already used by /leads) rather than a new AI call. */
export async function draftFinalAttempts(
  prospectIds: string[]
): Promise<{ success: true; drafted: number; failed: number } | { success: false; error: string }> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const results = await Promise.all(
    prospectIds.map((id) => draftProspectDm(tenant.slug, id, FINAL_ATTEMPT_CONTEXT))
  );
  const drafted = results.filter((r) => r.success).length;
  revalidatePath("/dashboard");
  return { success: true, drafted, failed: results.length - drafted };
}

export async function setRowDueAt(rowRef: RowRef, dueAt: string | null): Promise<ActionResult> {
  const ctx = await withContext();
  if ("error" in ctx) return { success: false, error: ctx.error };
  const result = await setDueAt(ctx.supabase, ctx.tenantSlug, rowRef, dueAt);
  if (!result.ok) return { success: false, error: "Couldn't update" };
  revalidatePath("/dashboard");
  return { success: true };
}
