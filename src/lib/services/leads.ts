import type {
  Lead,
  LeadStatus,
  LeadSummary,
  LeadType,
  LeadValue,
} from "@/lib/types/leads";
import { createClient } from "@/lib/supabase/server";

export async function getLeads(tenantSlug: string): Promise<Lead[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    tenantSlug: row.tenant_slug,
    name: row.name,
    company: row.company ?? null,
    type: row.type as LeadType,
    status: row.status as LeadStatus,
    value: row.value as LeadValue,
    lastContact: row.last_contact ?? null,
    nextAction: row.next_action ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  }));
}

export function summarize(leads: Lead[]): LeadSummary {
  return {
    total: leads.length,
    warm: leads.filter((l) => l.status === "warm").length,
    cold: leads.filter((l) => l.status === "cold").length,
    newCount: leads.filter((l) => l.status === "new").length,
  };
}
