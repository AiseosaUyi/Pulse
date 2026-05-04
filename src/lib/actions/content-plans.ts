"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { generatePlanBatch } from "@/lib/ai/generate-video-plan";
import type {
  ContentPlan,
  ContentPlanFeedback,
  ContentPlanOutput,
  ContentPlanStatus,
  PlanPlatform,
} from "@/lib/types/content-engine";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

async function assertMember(tenantSlug: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .rpc("is_tenant_member", { p_slug: tenantSlug })
    .single<boolean>();
  if (data !== true) return "You don't have access to this workspace";
  return null;
}

interface GenerateInput {
  tenantSlug: string;
  platform: PlanPlatform;
  goal?: "engagement" | "conversion" | "awareness";
}

export async function generatePlanBatchAction(
  input: GenerateInput
): Promise<ActionResult<{ batchId: string; plans: ContentPlan[] }>> {
  const user = await requireUser();
  const denial = await assertMember(input.tenantSlug);
  if (denial) return { success: false, error: denial };

  try {
    const result = await generatePlanBatch({
      tenantSlug: input.tenantSlug,
      platform: input.platform,
      goal: input.goal,
      count: 3,
      createdBy: user.id,
    });
    revalidatePath("/ai-content");
    return { success: true, batchId: result.batchId, plans: result.plans };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Generation failed",
    };
  }
}

interface UpdatePlanPatch {
  output?: Partial<ContentPlanOutput>;
  status?: ContentPlanStatus;
}

export async function updatePlan(
  planId: string,
  patch: UpdatePlanPatch
): Promise<ActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("content_plans")
    .select("id, tenant_slug, output")
    .eq("id", planId)
    .single();

  if (!row) return { success: false, error: "Plan not found" };
  const denial = await assertMember(row.tenant_slug as string);
  if (denial) return { success: false, error: denial };

  const dbPatch: Record<string, unknown> = {};
  if (patch.output) {
    const merged = { ...(row.output as ContentPlanOutput), ...patch.output };
    dbPatch.output = merged;
  }
  if (patch.status !== undefined) dbPatch.status = patch.status;

  if (Object.keys(dbPatch).length === 0) {
    return { success: true };
  }

  const { error } = await supabase
    .from("content_plans")
    .update(dbPatch)
    .eq("id", planId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/ai-content");
  return { success: true };
}

export async function setPlanFeedback(
  planId: string,
  feedback: ContentPlanFeedback,
  notes?: string | null
): Promise<ActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("content_plans")
    .select("id, tenant_slug")
    .eq("id", planId)
    .single();

  if (!row) return { success: false, error: "Plan not found" };
  const denial = await assertMember(row.tenant_slug as string);
  if (denial) return { success: false, error: denial };

  const { error } = await supabase
    .from("content_plans")
    .update({
      feedback,
      feedback_notes: notes ?? null,
    })
    .eq("id", planId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/ai-content");
  return { success: true };
}

export async function regeneratePlan(
  planId: string
): Promise<ActionResult<{ newPlanId: string }>> {
  const user = await requireUser();

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("content_plans")
    .select("id, tenant_slug, platform, batch_id")
    .eq("id", planId)
    .single();

  if (!row) return { success: false, error: "Plan not found" };
  const denial = await assertMember(row.tenant_slug as string);
  if (denial) return { success: false, error: denial };

  try {
    // Single-plan regeneration runs a 1-count batch (the rotator
    // picks whatever's least-recently-used, which is typically NOT
    // the format we just rejected). Replaces the original.
    const result = await generatePlanBatch({
      tenantSlug: row.tenant_slug as string,
      platform: row.platform as PlanPlatform,
      count: 1,
      createdBy: user.id,
    });
    if (result.plans.length === 0) {
      return { success: false, error: "Regeneration produced nothing" };
    }
    const newPlan = result.plans[0];
    // Re-stamp the new plan with the original's batch_id so it shows
    // up on the same card in the UI.
    const admin = createAdminClient();
    await admin
      .from("content_plans")
      .update({ batch_id: row.batch_id })
      .eq("id", newPlan.id);
    // Soft-dismiss the old plan.
    await admin
      .from("content_plans")
      .update({ status: "dismissed" })
      .eq("id", planId);

    revalidatePath("/ai-content");
    return { success: true, newPlanId: newPlan.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Regeneration failed",
    };
  }
}

export async function deletePlan(planId: string): Promise<ActionResult> {
  await requireUser();

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("content_plans")
    .select("id, tenant_slug")
    .eq("id", planId)
    .single();

  if (!row) return { success: false, error: "Plan not found" };
  const denial = await assertMember(row.tenant_slug as string);
  if (denial) return { success: false, error: denial };

  const { error } = await supabase
    .from("content_plans")
    .delete()
    .eq("id", planId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/ai-content");
  return { success: true };
}

// Promotes a plan into the scheduled_posts calendar. Caption =
// the hook (ready_prompt is too long); user can edit downstream.
export async function sendPlanToScheduledPosts(
  planId: string,
  scheduledFor: string
): Promise<ActionResult<{ scheduledId: string }>> {
  await requireUser();

  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("content_plans")
    .select("id, tenant_slug, platform, output")
    .eq("id", planId)
    .single();

  if (!plan) return { success: false, error: "Plan not found" };
  const denial = await assertMember(plan.tenant_slug as string);
  if (denial) return { success: false, error: denial };

  const output = plan.output as ContentPlanOutput;
  const { data: inserted, error } = await supabase
    .from("scheduled_posts")
    .insert({
      tenant_slug: plan.tenant_slug,
      brief_id: null,
      platform: plan.platform,
      content_type: "video",
      caption: output.hook,
      scheduled_for: scheduledFor,
      status: "draft",
      notes: `From content plan ${planId}`,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  // Mark the plan as used so it stops appearing in active draft lists.
  await supabase
    .from("content_plans")
    .update({ status: "used" })
    .eq("id", planId);

  revalidatePath("/ai-content");
  return { success: true, scheduledId: inserted.id as string };
}
