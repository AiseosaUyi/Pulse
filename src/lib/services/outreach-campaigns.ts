import { createClient } from "@/lib/supabase/server";
import type { OutreachCampaignRecord } from "@/lib/types/outreach-intelligence";

function campaignRowTo(row: Record<string, unknown>): OutreachCampaignRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    business: (row.business as string | null) ?? null,
    status: row.status as OutreachCampaignRecord["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listOutreachCampaigns(
  tenantSlug: string
): Promise<OutreachCampaignRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_campaigns")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .neq("status", "archived")
    .order("name", { ascending: true });
  return (data ?? []).map((r) => campaignRowTo(r as Record<string, unknown>));
}

export async function getProspectCampaignIds(
  prospectId: string
): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prospect_campaigns")
    .select("campaign_id")
    .eq("prospect_id", prospectId);
  return (data ?? []).map((r) => r.campaign_id as string);
}
