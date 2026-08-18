"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { executeProspectSearch } from "@/lib/services/prospect-searches-runner";
import type {
  OutboundPlatform,
  ProspectSearchRecord,
  SignalType,
} from "@/lib/types/outbound";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export interface ProspectSearchInput {
  name: string;
  platform: OutboundPlatform;
  signalType: SignalType;
  query: string;
  filters?: Record<string, unknown>;
  autoQualify?: boolean;
}

function rowTo(row: Record<string, unknown>): ProspectSearchRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    name: row.name as string,
    platform: row.platform as OutboundPlatform,
    signalType: row.signal_type as SignalType,
    query: row.query as string,
    filters: (row.filters ?? {}) as Record<string, unknown>,
    lastRunAt: (row.last_run_at as string) ?? null,
    lastResultCount: (row.last_result_count as number) ?? 0,
    autoQualify: Boolean(row.auto_qualify),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function createProspectSearch(
  tenantSlug: string,
  input: ProspectSearchInput
): Promise<ActionResult<{ search: ProspectSearchRecord }>> {
  const user = await requireUser();
  if (!input.name.trim() || !input.query.trim()) {
    return { success: false, error: "Name and query are required" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospect_searches")
    .insert({
      tenant_slug: tenantSlug,
      name: input.name.trim(),
      platform: input.platform,
      signal_type: input.signalType,
      query: input.query.trim(),
      filters: input.filters ?? {},
      auto_qualify: input.autoQualify ?? false,
      created_by: user.id,
    })
    .select("*")
    .single();
  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }
  revalidatePath("/leads");
  return { success: true, search: rowTo(data) };
}

export async function updateProspectSearch(
  tenantSlug: string,
  id: string,
  patch: Partial<ProspectSearchInput>
): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.platform !== undefined) update.platform = patch.platform;
  if (patch.signalType !== undefined) update.signal_type = patch.signalType;
  if (patch.query !== undefined) update.query = patch.query.trim();
  if (patch.filters !== undefined) update.filters = patch.filters;
  if (patch.autoQualify !== undefined) update.auto_qualify = patch.autoQualify;
  if (Object.keys(update).length === 0) {
    return { success: false, error: "No changes" };
  }
  const { error } = await supabase
    .from("prospect_searches")
    .update(update)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function deleteProspectSearch(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("prospect_searches")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

/**
 * On-demand "Run now" button. Runs discovery + optional auto-qualify
 * inline and returns the outcome so the UI can surface counts.
 */
export async function runProspectSearchNow(
  tenantSlug: string,
  id: string
): Promise<
  ActionResult<{
    inserted: number;
    qualified: number;
    skipped: number;
    candidates: number;
    diagnostic?: string;
  }>
> {
  await requireUser();
  try {
    const outcome = await executeProspectSearch(tenantSlug, id);
    if (outcome.errors.length > 0 && outcome.insertedCount === 0) {
      return { success: false, error: outcome.errors.join("; ") };
    }
    revalidatePath("/leads");
    return {
      success: true,
      inserted: outcome.insertedCount,
      qualified: outcome.qualifiedCount,
      skipped: outcome.skippedCount,
      candidates: outcome.candidateCount,
      diagnostic: outcome.diagnostic,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Run failed",
    };
  }
}
