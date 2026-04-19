import { createClient } from "@/lib/supabase/server";
import type {
  CoachActionRecord,
  CoachSourceType,
  CoachStatus,
} from "@/lib/types/coach";

interface Row {
  id: string;
  tenant_slug: string;
  source_type: CoachSourceType;
  source_id: string | null;
  title: string;
  description: string;
  impact_area: string;
  priority: number;
  status: CoachStatus;
  snoozed_until: string | null;
  due_at: string | null;
  completed_at: string | null;
  action_href: string | null;
  cta_label: string | null;
  created_by_ai: boolean;
  generator_model: string | null;
  generator_cost_usd: number | string | null;
  created_at: string;
  updated_at: string;
}

function rowTo(row: Row): CoachActionRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    description: row.description,
    impactArea: row.impact_area,
    priority: (row.priority as 1 | 2 | 3) ?? 2,
    status: row.status,
    snoozedUntil: row.snoozed_until,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    actionHref: row.action_href,
    ctaLabel: row.cta_label ?? "Start",
    createdByAi: row.created_by_ai,
    generatorModel: row.generator_model,
    generatorCostUsd: Number(row.generator_cost_usd ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The "what your AI team is working on" feed — pending + in-progress
 * actions ordered by priority then recency. Snoozed items surface
 * only after their wake time. Dismissed + done stay hidden from the
 * main feed (available via listCoachHistory).
 */
export async function listActiveCoachActions(
  tenantSlug: string,
  limit = 10
): Promise<CoachActionRecord[]> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("coach_actions")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["pending", "in_progress", "snoozed"])
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

export async function countActiveCoachActions(
  tenantSlug: string
): Promise<number> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { count, error } = await supabase
    .from("coach_actions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_slug", tenantSlug)
    .in("status", ["pending", "in_progress", "snoozed"])
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`);
  if (error) return 0;
  return count ?? 0;
}

export async function listCoachHistory(
  tenantSlug: string,
  limit = 50
): Promise<CoachActionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coach_actions")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["done", "dismissed"])
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Row[]).map(rowTo);
}

export async function getCoachAction(
  tenantSlug: string,
  id: string
): Promise<CoachActionRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coach_actions")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowTo(data as Row);
}
