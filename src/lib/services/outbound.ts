import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { BrandPositioning } from "@/lib/ai/brand-positioning";
import { draftOutboundDmAi, OutboundAiError } from "@/lib/ai/outbound";
import type {
  InboundMessageRecord,
  OutboundDmRecord,
  OutboundDmStatus,
  OutboundPlatform,
  ProspectQuality,
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
  | "duplicateOfId"
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
  duplicate_of_id: string | null;
  category: string | null;
  location: string | null;
  verified_name: string | null;
  event_title: string | null;
  phone: string | null;
  last_reachout_at: string | null;
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
    quality: row.quality,
    duplicateOfId: row.duplicate_of_id,
    notes: row.notes,
    category: row.category,
    location: row.location,
    verifiedName: row.verified_name,
    eventTitle: row.event_title,
    phone: row.phone,
    lastReachoutAt: row.last_reachout_at,
    lastTouchedAt: row.last_touched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProspects(
  client: SupabaseClient,
  tenantSlug: string,
  filter: {
    status?: ProspectStatus | "all";
    platform?: OutboundPlatform;
    quality?: ProspectQuality | "all";
    duplicatesOnly?: boolean;
    qualificationScoreMin?: number;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{ data: ProspectRecord[]; total: number }> {
  const pageSize = filter.pageSize ?? 50;
  const page = filter.page ?? 0;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = client
    .from("prospects")
    .select("*", { count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (filter.status && filter.status !== "all") {
    query = query.eq("status", filter.status);
  }
  if (filter.platform) {
    query = query.eq("platform", filter.platform);
  }
  if (filter.duplicatesOnly) {
    query = query.not("duplicate_of_id", "is", null);
  } else if (filter.quality && filter.quality !== "all") {
    query = query.eq("quality", filter.quality);
  }
  if (filter.qualificationScoreMin !== undefined) {
    query = query.gte("qualification_score", filter.qualificationScoreMin);
  }
  if (filter.search) {
    // Spliced into a raw PostgREST `.or(...)` filter string below — strip
    // characters with special meaning in that grammar (,.()"%*) so a
    // search term can't inject additional filter clauses or malform the
    // query. None of these are meaningful in a fuzzy handle/name/bio search.
    const sanitized = filter.search.replace(/[,.()"%*]/g, "").trim();
    if (sanitized) {
      const like = `%${sanitized}%`;
      query = query.or(
        `handle.ilike.${like},display_name.ilike.${like},bio.ilike.${like}`
      );
    }
  }
  const { data, error, count } = await query;
  if (error || !data) return { data: [], total: 0 };
  return { data: (data as ProspectRow[]).map(prospectRowTo), total: count ?? 0 };
}

export async function getProspect(
  client: SupabaseClient,
  tenantSlug: string,
  id: string
): Promise<ProspectRecord | null> {
  const { data, error } = await client
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

function dmRowTo(row: Record<string, unknown>): OutboundDmRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    prospectId: row.prospect_id as string,
    version: row.version as number,
    body: row.body as string,
    followupBody: (row.followup_body as string) ?? null,
    status: row.status as OutboundDmStatus,
    approvedBy: (row.approved_by as string) ?? null,
    approvedAt: (row.approved_at as string) ?? null,
    sentAt: (row.sent_at as string) ?? null,
    externalId: (row.external_id as string) ?? null,
    error: (row.error as string) ?? null,
    generatorModel: (row.generator_model as string) ?? null,
    generatorCostUsd: Number(row.generator_cost_usd ?? 0),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listDmsForProspect(
  client: SupabaseClient,
  tenantSlug: string,
  prospectId: string
): Promise<OutboundDmRecord[]> {
  const { data, error } = await client
    .from("outbound_dms")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", prospectId)
    .order("version", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(dmRowTo);
}

async function latestDm(
  client: SupabaseClient,
  tenantSlug: string,
  prospectId: string
): Promise<OutboundDmRecord | null> {
  const { data, error } = await client
    .from("outbound_dms")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", prospectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return dmRowTo(data as Record<string, unknown>);
}

function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export interface UpsertProspectInput {
  platform: OutboundPlatform;
  handle: string;
  displayName?: string | null;
  profileUrl?: string | null;
  bio?: string | null;
  followerCount?: number | null;
  signalSummary?: string | null;
  signalData?: Record<string, unknown>;
}

/** Upsert-by-(tenant, platform, handle), mirroring the logic inline in
 * `/api/ext/prospect` (POST) — extracted here so /api/v1 shares it
 * without touching the extension route's own copy. */
export async function upsertProspect(
  client: SupabaseClient,
  tenantSlug: string,
  input: UpsertProspectInput
): Promise<{ prospect: ProspectRecord; dm: OutboundDmRecord | null } | null> {
  const handle = normalizeHandle(input.handle);
  if (!handle) return null;
  const { data, error } = await client
    .from("prospects")
    .upsert(
      {
        tenant_slug: tenantSlug,
        platform: input.platform,
        handle,
        display_name: input.displayName ?? null,
        profile_url: input.profileUrl ?? null,
        bio: input.bio ?? null,
        follower_count: input.followerCount ?? null,
        signal_summary: input.signalSummary ?? null,
        signal_data: input.signalData ?? undefined,
      },
      { onConflict: "tenant_slug,platform,handle" }
    )
    .select("*")
    .single();
  if (error || !data) return null;
  const prospect = prospectRowTo(data as ProspectRow);
  const dm = await latestDm(client, tenantSlug, prospect.id);
  return { prospect, dm };
}

/** AI-draft a DM for a prospect and save it as the next version,
 * cascading the prospect's status. Mirrors `/api/ext/draft-dm`. */
export async function draftAndSaveDm(
  client: SupabaseClient,
  tenantSlug: string,
  prospectId: string,
  opts: {
    tenantName: string;
    voice: BrandVoice | null;
    positioning: BrandPositioning | null;
    context?: string;
  }
): Promise<{ prospect: ProspectRecord; dm: OutboundDmRecord; rationale: string } | { error: string } | null> {
  const prospect = await getProspect(client, tenantSlug, prospectId);
  if (!prospect) return null;

  try {
    const { result, model, costUsd } = await draftOutboundDmAi({
      tenantSlug,
      tenantName: opts.tenantName,
      voice: opts.voice,
      positioning: opts.positioning,
      prospect,
      context: opts.context,
    });

    const { data: last } = await client
      .from("outbound_dms")
      .select("version")
      .eq("tenant_slug", tenantSlug)
      .eq("prospect_id", prospectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((last?.version as number | null) ?? 0) + 1;

    const { data: dmRow, error: dmError } = await client
      .from("outbound_dms")
      .insert({
        tenant_slug: tenantSlug,
        prospect_id: prospectId,
        version: nextVersion,
        body: result.body,
        followup_body: result.followup_body,
        status: "drafted",
        generator_model: model,
        generator_cost_usd: costUsd,
      })
      .select("*")
      .single();
    if (dmError || !dmRow) return { error: dmError?.message ?? "DM save failed" };

    await client
      .from("prospects")
      .update({ status: "drafted", last_touched_at: new Date().toISOString() })
      .eq("tenant_slug", tenantSlug)
      .eq("id", prospectId);

    return {
      prospect: { ...prospect, status: "drafted" },
      dm: dmRowTo(dmRow as Record<string, unknown>),
      rationale: result.rationale,
    };
  } catch (err) {
    const msg =
      err instanceof OutboundAiError
        ? "DM draft failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { error: msg };
  }
}

/** Mark a DM sent, cascading the prospect's pipeline stage. Mirrors
 * `/api/ext/dm/[id]/sent`. Returns null if the DM doesn't belong to
 * the tenant. */
export async function markDmSent(
  client: SupabaseClient,
  tenantSlug: string,
  dmId: string
): Promise<{ prospectId: string } | null> {
  const { data: dm, error } = await client
    .from("outbound_dms")
    .select("id, prospect_id")
    .eq("tenant_slug", tenantSlug)
    .eq("id", dmId)
    .maybeSingle();
  if (error || !dm) return null;

  const nowIso = new Date().toISOString();
  await client
    .from("outbound_dms")
    .update({ status: "sent", sent_at: nowIso })
    .eq("tenant_slug", tenantSlug)
    .eq("id", dm.id);
  await client
    .from("prospects")
    .update({ status: "sent", last_touched_at: nowIso })
    .eq("tenant_slug", tenantSlug)
    .eq("id", dm.prospect_id);

  return { prospectId: dm.prospect_id as string };
}

/** Shared implementation behind `updateProspectStatus` (the
 * `"use server"` action, which stays thin and keeps its stable
 * signature for existing client-component callers) and the
 * `/api/v1/prospects/:id/stage` route. */
export async function setProspectStatus(
  client: SupabaseClient,
  tenantSlug: string,
  id: string,
  status: ProspectStatus,
  notes?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch: Record<string, unknown> = {
    status,
    last_touched_at: new Date().toISOString(),
  };
  if (notes !== undefined) patch.notes = notes;
  const { error } = await client
    .from("prospects")
    .update(patch)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Insert a prospect note directly (no session user exists under token
 * auth, so `addProspectNote()` in actions/prospect-notes.ts — which
 * requires `getCurrentUser()` — can't be reused as-is). Attributes
 * `created_by` to whoever the caller resolves (e.g. the token's own
 * `created_by` user). Shared by /api/v1/prospects/:id/notes and the
 * pulse_add_prospect_note MCP tool. */
export async function addProspectNoteAdmin(
  client: SupabaseClient,
  tenantSlug: string,
  prospectId: string,
  body: string,
  createdBy: string | null
): Promise<{ id: string; createdAt: string } | { error: string }> {
  const { data: prospect } = await client
    .from("prospects")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("id", prospectId)
    .maybeSingle();
  if (!prospect) return { error: "Prospect not found" };

  const { data, error } = await client
    .from("prospect_notes")
    .insert({
      tenant_slug: tenantSlug,
      prospect_id: prospectId,
      body: body.trim(),
      created_by: createdBy,
    })
    .select("id, created_at")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };

  return { id: data.id, createdAt: data.created_at };
}

/** Shared implementation behind `recordInboundReply` (the
 * `"use server"` action) and `/api/v1/prospects/:id/inbound`. */
export async function recordInboundMessage(
  client: SupabaseClient,
  tenantSlug: string,
  prospectId: string,
  input: { body: string; inReplyToDmId?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Body required" };
  const prospect = await getProspect(client, tenantSlug, prospectId);
  if (!prospect) return { ok: false, error: "Prospect not found" };

  const { error } = await client.from("inbound_messages").insert({
    tenant_slug: tenantSlug,
    prospect_id: prospectId,
    in_reply_to_dm_id: input.inReplyToDmId ?? null,
    platform: prospect.platform,
    body,
  });
  if (error) return { ok: false, error: error.message };

  await client
    .from("prospects")
    .update({ status: "replied", last_touched_at: new Date().toISOString() })
    .eq("tenant_slug", tenantSlug)
    .eq("id", prospectId);
  if (input.inReplyToDmId) {
    await client
      .from("outbound_dms")
      .update({ status: "replied" })
      .eq("tenant_slug", tenantSlug)
      .eq("id", input.inReplyToDmId);
  }

  return { ok: true };
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

const TERMINAL_STATUSES: ProspectStatus[] = [
  "closed_won",
  "closed_lost",
  "dismissed",
  "unqualified",
];

export async function countOutboundKpis(
  tenantSlug: string
): Promise<{
  total: number;
  active: number;
  qualified: number;
  drafted: number;
  sent: number;
  replied: number;
  inboxUnread: number;
  newThisWeek: number;
  silentOver7Days: number;
}> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("prospects")
    .select("status, created_at, last_reachout_at, last_touched_at")
    .eq("tenant_slug", tenantSlug);
  if (error || !rows) {
    return {
      total: 0,
      active: 0,
      qualified: 0,
      drafted: 0,
      sent: 0,
      replied: 0,
      inboxUnread: 0,
      newThisWeek: 0,
      silentOver7Days: 0,
    };
  }
  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const counts = {
    total: rows.length,
    active: 0,
    qualified: 0,
    drafted: 0,
    sent: 0,
    replied: 0,
    inboxUnread: 0,
    newThisWeek: 0,
    silentOver7Days: 0,
  };
  for (const row of rows) {
    const status = row.status as ProspectStatus;
    if (status === "qualified") counts.qualified++;
    else if (status === "drafted" || status === "approved") counts.drafted++;
    else if (status === "sent") counts.sent++;
    else if (status === "replied" || status === "handed_off") counts.replied++;

    if (!TERMINAL_STATUSES.includes(status)) counts.active++;

    if (
      row.created_at &&
      nowMs - new Date(row.created_at as string).getTime() <= sevenDaysMs
    ) {
      counts.newThisWeek++;
    }

    if (status === "sent") {
      const ref = (row.last_reachout_at ?? row.last_touched_at) as
        | string
        | null;
      if (ref && nowMs - new Date(ref).getTime() > sevenDaysMs) {
        counts.silentOver7Days++;
      }
    }
  }
  const { count: unread } = await supabase
    .from("inbound_messages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_slug", tenantSlug)
    .is("read_at", null);
  counts.inboxUnread = unread ?? 0;
  return counts;
}

/** Resolve a handle typed into the "mark as duplicate" field to a real
 * prospect id within the tenant. Handles aren't globally unique (unique
 * constraint is tenant_slug+platform+handle), so this returns the first
 * match — good enough for the duplicate-linking UX, which is a manual,
 * reviewed action. */
export async function findProspectIdByHandle(
  client: SupabaseClient,
  tenantSlug: string,
  handle: string
): Promise<{ id: string; handle: string } | null> {
  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return null;
  const { data } = await client
    .from("prospects")
    .select("id, handle")
    .eq("tenant_slug", tenantSlug)
    .eq("handle", normalized)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, handle: data.handle as string };
}

export async function getProspectHandle(
  client: SupabaseClient,
  tenantSlug: string,
  id: string
): Promise<string | null> {
  const { data } = await client
    .from("prospects")
    .select("handle")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  return (data?.handle as string | undefined) ?? null;
}

export async function countProspectQualityKpis(
  tenantSlug: string
): Promise<Record<ProspectQuality, number> & { duplicates: number }> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("prospects")
    .select("quality, duplicate_of_id")
    .eq("tenant_slug", tenantSlug);
  const counts: Record<ProspectQuality, number> & { duplicates: number } = {
    unscored: 0,
    hot: 0,
    warm: 0,
    cold: 0,
    dead: 0,
    duplicates: 0,
  };
  if (error || !rows) return counts;
  for (const row of rows) {
    const quality = row.quality as ProspectQuality;
    if (quality in counts) counts[quality]++;
    if (row.duplicate_of_id) counts.duplicates++;
  }
  return counts;
}
