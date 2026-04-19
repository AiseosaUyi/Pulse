import { createClient } from "@/lib/supabase/server";
import type { OutboundDmRecord } from "@/lib/types/outbound";

/**
 * Pull all outbound DMs for a tenant in one query, grouped by
 * prospect so the UI can show the latest draft per prospect without
 * an N+1 fan of requests.
 */
export async function listAllDmsByProspect(
  tenantSlug: string
): Promise<Map<string, OutboundDmRecord[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outbound_dms")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("version", { ascending: false });
  const grouped = new Map<string, OutboundDmRecord[]>();
  if (error || !data) return grouped;
  for (const row of data) {
    const rec: OutboundDmRecord = {
      id: row.id,
      tenantSlug: row.tenant_slug,
      prospectId: row.prospect_id,
      version: row.version,
      body: row.body,
      followupBody: row.followup_body,
      status: row.status,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      sentAt: row.sent_at,
      externalId: row.external_id,
      error: row.error,
      generatorModel: row.generator_model,
      generatorCostUsd: Number(row.generator_cost_usd ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    const list = grouped.get(rec.prospectId) ?? [];
    list.push(rec);
    grouped.set(rec.prospectId, list);
  }
  return grouped;
}
