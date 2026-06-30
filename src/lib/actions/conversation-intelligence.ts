"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { getTenant } from "@/lib/services/tenants";
import { getProspect } from "@/lib/services/outbound";
import { analyzeConversationAi } from "@/lib/ai/conversation-intelligence";
import { getThreadMessages } from "@/lib/services/outreach-intelligence";
import type { ConversationAnalysisRecord } from "@/lib/types/outreach-intelligence";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

// ── Analyze a prospect's conversation ───────────────────────────────────────

export async function analyzeProspectConversation(
  tenantSlug: string,
  prospectId: string,
  triggerType: ConversationAnalysisRecord["triggerType"] = "manual",
  triggerId?: string
): Promise<ActionResult<{ analysis: ConversationAnalysisRecord }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const [tenant, prospect] = await Promise.all([
    getTenant(tenantSlug),
    getProspect(tenantSlug, prospectId),
  ]);
  if (!tenant) return { success: false, error: "Tenant not found" };
  if (!prospect) return { success: false, error: "Prospect not found" };

  const thread = await getThreadMessages(prospectId);

  let result;
  try {
    result = await analyzeConversationAi({
      tenantSlug,
      tenantName: tenant.name,
      prospect,
      thread,
    });
  } catch {
    return { success: false, error: "AI analysis failed — try again" };
  }

  // Compute recommended_follow_up_at from recommended_wait_days
  let recommendedFollowUpAt: string | null = null;
  if (result.result.recommended_wait_days != null) {
    const d = new Date();
    d.setDate(d.getDate() + result.result.recommended_wait_days);
    recommendedFollowUpAt = d.toISOString();
  }

  // Write analysis — the DB trigger auto-applies follow_up_at to prospect
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("conversation_analyses")
    .insert({
      tenant_slug: tenantSlug,
      prospect_id: prospectId,
      trigger_type: triggerType,
      trigger_id: triggerId ?? null,
      conversation_stage: result.result.conversation_stage,
      intent_summary: result.result.intent_summary,
      recommended_follow_up_at: recommendedFollowUpAt,
      recommended_follow_up_note: result.result.recommended_follow_up_note,
      recommended_wait_days: result.result.recommended_wait_days,
      objection_detected: result.result.objection_detected,
      objection_category: result.result.objection_category,
      risk_level: result.result.risk_level,
      gruve_relevant: result.result.gruve_relevant,
      sippoy_relevant: result.result.sippoy_relevant,
      model: result.model,
      cost_usd: result.costUsd,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Failed to save analysis" };
  }

  revalidatePath("/leads");
  return {
    success: true,
    analysis: {
      id: data.id as string,
      tenantSlug: data.tenant_slug as string,
      prospectId: data.prospect_id as string,
      triggerType: data.trigger_type as ConversationAnalysisRecord["triggerType"],
      triggerId: (data.trigger_id as string | null) ?? null,
      conversationStage: data.conversation_stage as ConversationAnalysisRecord["conversationStage"],
      intentSummary: data.intent_summary as string,
      recommendedFollowUpAt: (data.recommended_follow_up_at as string | null) ?? null,
      recommendedFollowUpNote: (data.recommended_follow_up_note as string | null) ?? null,
      recommendedWaitDays: (data.recommended_wait_days as number | null) ?? null,
      objectionDetected: data.objection_detected as boolean,
      objectionCategory: (data.objection_category as ConversationAnalysisRecord["objectionCategory"]) ?? null,
      riskLevel: data.risk_level as ConversationAnalysisRecord["riskLevel"],
      gruveRelevant: data.gruve_relevant as boolean,
      sippoyRelevant: data.sippoy_relevant as boolean,
      model: (data.model as string | null) ?? null,
      costUsd: data.cost_usd as number,
      createdAt: data.created_at as string,
    },
  };
}

// ── Manual follow-up date override ──────────────────────────────────────────

export async function setFollowUpDate(
  tenantSlug: string,
  prospectId: string,
  followUpAt: Date,
  note?: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("prospects")
    .update({
      follow_up_at: followUpAt.toISOString(),
      follow_up_note: note ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", prospectId)
    .eq("tenant_slug", tenantSlug);

  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

// ── Snooze a follow-up ───────────────────────────────────────────────────────

export async function snoozeFollowUp(
  tenantSlug: string,
  prospectId: string,
  days: number
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const newDate = new Date();
  newDate.setDate(newDate.getDate() + days);

  const supabase = await createClient();
  const { error } = await supabase
    .from("prospects")
    .update({
      follow_up_at: newDate.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", prospectId)
    .eq("tenant_slug", tenantSlug);

  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

// ── Load panel data (thread + follow-up + campaign IDs in one round-trip) ───

export async function loadProspectPanelData(
  tenantSlug: string,
  prospectId: string
): Promise<
  ActionResult<{
    followUpAt: string | null;
    followUpNote: string | null;
    latestAnalysis: import("@/lib/types/outreach-intelligence").ConversationAnalysisRecord | null;
    thread: import("@/lib/types/outreach-intelligence").ThreadEvent[];
    campaignIds: string[];
  }>
> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const [
    { getConversationThread, getLatestAnalysis },
    { getProspectCampaignIds },
    { createClient: mkClient },
  ] = await Promise.all([
    import("@/lib/services/outreach-intelligence"),
    import("@/lib/services/outreach-campaigns"),
    import("@/lib/supabase/server"),
  ]);

  const supabase = await mkClient();
  const { data: row } = await supabase
    .from("prospects")
    .select("follow_up_at, follow_up_note")
    .eq("id", prospectId)
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();

  if (!row) return { success: false, error: "Prospect not found" };

  const [thread, latestAnalysis, campaignIds] = await Promise.all([
    getConversationThread(prospectId),
    getLatestAnalysis(prospectId),
    getProspectCampaignIds(prospectId),
  ]);

  return {
    success: true,
    followUpAt: (row.follow_up_at as string | null) ?? null,
    followUpNote: (row.follow_up_note as string | null) ?? null,
    latestAnalysis,
    thread,
    campaignIds,
  };
}

// ── Clear a follow-up ────────────────────────────────────────────────────────

export async function clearFollowUp(
  tenantSlug: string,
  prospectId: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("prospects")
    .update({
      follow_up_at: null,
      follow_up_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", prospectId)
    .eq("tenant_slug", tenantSlug);

  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}
