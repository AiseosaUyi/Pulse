import { createClient } from "@/lib/supabase/server";
import type {
  InboundMessageRecord,
  OutboundDmRecord,
  OutboundDmStatus,
  ProspectRecord,
  ProspectSearchRecord,
  ProspectStatus,
} from "@/lib/types/outbound";

type ProspectRow = Omit<
  ProspectRecord,
  | "tenantSlug"
  | "searchId"
  | "displayName"
  | "profileUrl"
  | "avatarUrl"
  | "followerCount"
  | "signalSummary"
  | "signalData"
  | "qualificationScore"
  | "qualificationReason"
  | "lastTouchedAt"
  | "createdAt"
  | "updatedAt"
> & {
  tenant_slug: string;
  search_id: string | null;
  display_name: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  follower_count: number | null;
  signal_summary: string | null;
  signal_data: Record<string, unknown> | null;
  qualification_score: number | null;
  qualification_reason: string | null;
  last_touched_at: string | null;
  created_at: string;
  updated_at: string;
};

function prospectRowTo(row: ProspectRow): ProspectRecord {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    searchId: row.search_id,
    platform: row.platform,
    handle: row.handle,
    displayName: row.display_name,
    profileUrl: row.profile_url,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    followerCount: row.follower_count,
    signalSummary: row.signal_summary,
    signalData: row.signal_data ?? {},
    qualificationScore: row.qualification_score,
    qualificationReason: row.qualification_reason,
    status: row.status,
    notes: row.notes,
    lastTouchedAt: row.last_touched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProspects(
  tenantSlug: string,
  filter: { status?: ProspectStatus | "all"; limit?: number } = {}
): Promise<ProspectRecord[]> {
  const supabase = await createClient();
  let query = supabase
    .from("prospects")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("updated_at", { ascending: false })
    .limit(filter.limit ?? 1000);
  if (filter.status && filter.status !== "all") {
    query = query.eq("status", filter.status);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as ProspectRow[]).map(prospectRowTo);
}

export async function getProspect(
  tenantSlug: string,
  id: string
): Promise<ProspectRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return prospectRowTo(data as ProspectRow);
}

export async function listSearches(
  tenantSlug: string
): Promise<ProspectSearchRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospect_searches")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    tenantSlug: row.tenant_slug,
    name: row.name,
    platform: row.platform,
    signalType: row.signal_type,
    query: row.query,
    filters: (row.filters ?? {}) as Record<string, unknown>,
    lastRunAt: row.last_run_at,
    lastResultCount: row.last_result_count,
    autoQualify: row.auto_qualify,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listDmsForProspect(
  tenantSlug: string,
  prospectId: string
): Promise<OutboundDmRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outbound_dms")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", prospectId)
    .order("version", { ascending: false });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    tenantSlug: row.tenant_slug,
    prospectId: row.prospect_id,
    version: row.version,
    body: row.body,
    followupBody: row.followup_body,
    status: row.status as OutboundDmStatus,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    externalId: row.external_id,
    error: row.error,
    generatorModel: row.generator_model,
    generatorCostUsd: Number(row.generator_cost_usd ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listInbox(
  tenantSlug: string,
  limit = 30
): Promise<InboundMessageRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inbound_messages")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    tenantSlug: row.tenant_slug,
    prospectId: row.prospect_id,
    inReplyToDmId: row.in_reply_to_dm_id,
    platform: row.platform,
    body: row.body,
    externalId: row.external_id,
    receivedAt: row.received_at,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export async function countOutboundKpis(
  tenantSlug: string
): Promise<{
  total: number;
  qualified: number;
  drafted: number;
  sent: number;
  replied: number;
  inboxUnread: number;
}> {
  const supabase = await createClient();
  const { data: statuses, error } = await supabase
    .from("prospects")
    .select("status")
    .eq("tenant_slug", tenantSlug);
  if (error || !statuses) {
    return {
      total: 0,
      qualified: 0,
      drafted: 0,
      sent: 0,
      replied: 0,
      inboxUnread: 0,
    };
  }
  const counts = {
    total: statuses.length,
    qualified: 0,
    drafted: 0,
    sent: 0,
    replied: 0,
    inboxUnread: 0,
  };
  for (const row of statuses) {
    if (row.status === "qualified") counts.qualified++;
    else if (row.status === "drafted" || row.status === "approved")
      counts.drafted++;
    else if (row.status === "sent") counts.sent++;
    else if (row.status === "replied" || row.status === "handed_off")
      counts.replied++;
  }
  const { count: unread } = await supabase
    .from("inbound_messages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_slug", tenantSlug)
    .is("read_at", null);
  counts.inboxUnread = unread ?? 0;
  return counts;
}
