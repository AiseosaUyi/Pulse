"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import {
  markHandoff,
  clearHandoff,
  type MarkHandoffInput,
  type ClearHandoffInput,
  type HandoffSummary,
} from "@/lib/services/handoff";

type ActionResult<T = unknown> = { success: true; data?: T } | { success: false; error: string };

async function withContext(): Promise<
  | { supabase: Awaited<ReturnType<typeof createClient>>; tenantSlug: string; userId: string }
  | { error: string }
> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No tenant selected" };
  const supabase = await createClient();
  return { supabase, tenantSlug: tenant.slug, userId: user.id };
}

export async function markConversationHandoffAction(
  input: Omit<MarkHandoffInput, "movedBy"> & { movedBy?: string | null }
): Promise<ActionResult<HandoffSummary>> {
  const ctx = await withContext();
  if ("error" in ctx) return { success: false, error: ctx.error };

  const result = await markHandoff(ctx.supabase, ctx.tenantSlug, {
    ...input,
    movedBy: input.movedBy ?? ctx.userId,
  });

  if (!result.ok) return { success: false, error: result.error };

  revalidatePath("/dashboard");
  revalidatePath("/conversations");
  return { success: true, data: result.handoff };
}

export async function clearConversationHandoffAction(
  input: Omit<ClearHandoffInput, "clearedBy">
): Promise<ActionResult> {
  const ctx = await withContext();
  if ("error" in ctx) return { success: false, error: ctx.error };

  const result = await clearHandoff(ctx.supabase, ctx.tenantSlug, {
    ...input,
    clearedBy: ctx.userId,
  });

  if (!result.ok) return { success: false, error: result.error };

  revalidatePath("/dashboard");
  revalidatePath("/conversations");
  return { success: true };
}
