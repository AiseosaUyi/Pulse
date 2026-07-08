import { createClient } from "@/lib/supabase/server";
import type { EventScraperRunRecord } from "@/lib/types/event-scraper";
import type { OutboundPlatform, ProspectRecord } from "@/lib/types/outbound";

// Local row mapper — same convention as qualify-backlog/route.ts,
// prospect-searches-runner.ts, outreach-intelligence.ts (each maps
// prospects rows locally rather than sharing one mapper across modules).
function prospectRowTo(row: Record<string, unknown>): ProspectRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    searchId: (row.search_id as string) ?? null,
    platform: row.platform as OutboundPlatform,
    handle: row.handle as string,
    displayName: (row.display_name as string) ?? null,
    profileUrl: (row.profile_url as string) ?? null,
    avatarUrl: (row.avatar_url as string) ?? null,
    bio: (row.bio as string) ?? null,
    followerCount: (row.follower_count as number) ?? null,
    signalSummary: (row.signal_summary as string) ?? null,
    signalData: (row.signal_data as Record<string, unknown>) ?? {},
    qualificationScore: (row.qualification_score as number) ?? null,
    qualificationReason: (row.qualification_reason as string) ?? null,
    status: row.status as ProspectRecord["status"],
    notes: (row.notes as string) ?? null,
    category: (row.category as string) ?? null,
    location: (row.location as string) ?? null,
    verifiedName: (row.verified_name as string) ?? null,
    eventTitle: (row.event_title as string) ?? null,
    phone: (row.phone as string) ?? null,
    lastReachoutAt: (row.last_reachout_at as string) ?? null,
    lastTouchedAt: (row.last_touched_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToRun(row: Record<string, unknown>): EventScraperRunRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    platform: row.platform as string,
    provider: row.provider as EventScraperRunRecord["provider"],
    status: row.status as EventScraperRunRecord["status"],
    trigger: row.trigger as EventScraperRunRecord["trigger"],
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) ?? null,
    candidatesFound: (row.candidates_found as number) ?? 0,
    prospectsCreated: (row.prospects_created as number) ?? 0,
    error: (row.error as Record<string, unknown>) ?? null,
  };
}

// Most recent runs across ALL platforms (old Apify-based + new in-house) —
// this is what unifies the two lineages in one Outbound UI list.
export async function listEventScraperRuns(
  tenantSlug: string,
  limit = 50
): Promise<EventScraperRunRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_scraper_runs")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map(rowToRun);
}

export async function listRunProspects(
  tenantSlug: string,
  runId: string
): Promise<ProspectRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("event_scraper_run_id", runId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(prospectRowTo);
}
