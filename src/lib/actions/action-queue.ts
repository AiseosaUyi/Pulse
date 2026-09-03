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
  assignQueueRow,
  setPriority,
  setDueAt,
  type RowRef,
  type QueuePriority,
  type QueueStatus,
} from "@/lib/services/action-queue";

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

export async function setRowStatus(
  rowRef: RowRef,
  status: QueueStatus,
  opts?: { resolutionNote?: string; snoozedUntil?: string }
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
  revalidatePath("/dashboard");
  return { success: true };
}

/** Claim (assign to self) or release a row. `null` clears the assignee. */
export async function claimRow(rowRef: RowRef, assignedTo: string | null): Promise<ActionResult> {
  const ctx = await withContext();
  if ("error" in ctx) return { success: false, error: ctx.error };
  const target = assignedTo === undefined ? ctx.userId : assignedTo;
  const result = await assignQueueRow(ctx.supabase, ctx.tenantSlug, rowRef, target);
  if (!result.ok) return { success: false, error: "Couldn't update assignment" };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function setRowPriority(rowRef: RowRef, priority: QueuePriority): Promise<ActionResult> {
  const ctx = await withContext();
  if ("error" in ctx) return { success: false, error: ctx.error };
  const result = await setPriority(ctx.supabase, ctx.tenantSlug, rowRef, priority);
  if (!result.ok) return { success: false, error: "Couldn't update priority" };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function setRowDueAt(rowRef: RowRef, dueAt: string | null): Promise<ActionResult> {
  const ctx = await withContext();
  if ("error" in ctx) return { success: false, error: ctx.error };
  const result = await setDueAt(ctx.supabase, ctx.tenantSlug, rowRef, dueAt);
  if (!result.ok) return { success: false, error: "Couldn't update" };
  revalidatePath("/dashboard");
  return { success: true };
}
