// Server-side runner that ties discovery → prospect upsert →
// optional auto-qualification together. Used by both the manual
// "Run now" action and the nightly cron.
//
// Admin client only (service role) so the cron can run without a
// user session and the action can cascade past RLS when inserting.

import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { getOutboundFilters } from "@/lib/server/outbound-filters";
import { qualifyProspectAi, OutboundAiError } from "@/lib/ai/outbound";
import {
  inputFromSearch,
  runDiscoverySearch,
  type ProspectCandidate,
} from "@/lib/ai/discover-prospects";
import type { ProspectRecord, ProspectSearchRecord } from "@/lib/types/outbound";

export interface RunSearchOutcome {
  searchId: string;
  queryUsed: string;
  rawResultCount: number;
  candidateCount: number;
  insertedCount: number;
  qualifiedCount: number;
  skippedCount: number;
  errors: string[];
  /** Human-readable reason zero candidates came back, when applicable. */
  diagnostic?: string;
}

interface RunOptions {
  /** Cap on new prospects inserted per run (ignores dedup hits). */
  maxNewPerRun?: number;
  /** When true + the search has auto_qualify, score every inserted prospect. */
  qualifyInline?: boolean;
}

function rowToSearch(row: Record<string, unknown>): ProspectSearchRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    name: row.name as string,
    platform: row.platform as ProspectSearchRecord["platform"],
    signalType: row.signal_type as ProspectSearchRecord["signalType"],
    query: row.query as string,
    filters: (row.filters ?? {}) as Record<string, unknown>,
    lastRunAt: (row.last_run_at as string) ?? null,
    lastResultCount: (row.last_result_count as number) ?? 0,
    autoQualify: Boolean(row.auto_qualify),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToProspect(row: Record<string, unknown>): ProspectRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    searchId: (row.search_id as string) ?? null,
    platform: row.platform as ProspectRecord["platform"],
    handle: row.handle as string,
    displayName: (row.display_name as string) ?? null,
    profileUrl: (row.profile_url as string) ?? null,
    avatarUrl: (row.avatar_url as string) ?? null,
    bio: (row.bio as string) ?? null,
    followerCount: (row.follower_count as number) ?? null,
    signalSummary: (row.signal_summary as string) ?? null,
    signalData: (row.signal_data ?? {}) as Record<string, unknown>,
    qualificationScore: (row.qualification_score as number) ?? null,
    qualificationReason: (row.qualification_reason as string) ?? null,
    status: row.status as ProspectRecord["status"],
    quality: (row.quality as ProspectRecord["quality"]) ?? "unscored",
    duplicateOfId: (row.duplicate_of_id as string) ?? null,
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

/**
 * Upsert candidates into the prospects table. Relies on the existing
 * (tenant_slug, platform, handle) unique constraint so re-running a
 * search doesn't multiply rows. Returns the inserted rows only —
 * we don't care to re-qualify existing prospects on every cron tick.
 */
async function upsertCandidates(
  tenantSlug: string,
  searchId: string,
  candidates: ProspectCandidate[],
  maxNewPerRun: number
): Promise<ProspectRecord[]> {
  if (candidates.length === 0) return [];
  const admin = createAdminClient();

  // Pre-fetch existing (tenant, platform, handle) tuples so we can
  // avoid re-scoring already-qualified prospects and also respect
  // the per-run cap.
  const handles = candidates.map((c) => c.handle);
  const { data: existing } = await admin
    .from("prospects")
    .select("platform, handle")
    .eq("tenant_slug", tenantSlug)
    .in("handle", handles);

  const existingSet = new Set(
    (existing ?? []).map((r) => `${r.platform}:${r.handle}`)
  );

  const toInsert = candidates
    .filter((c) => !existingSet.has(`${c.platform}:${c.handle}`))
    .slice(0, maxNewPerRun)
    .map((c) => ({
      tenant_slug: tenantSlug,
      search_id: searchId,
      platform: c.platform,
      handle: c.handle,
      profile_url: c.profileUrl,
      signal_summary: c.signalSummary,
      signal_data: c.signalData,
      status: "new" as const,
    }));

  if (toInsert.length === 0) return [];

  const { data, error } = await admin
    .from("prospects")
    .insert(toInsert)
    .select("*");

  if (error) {
    // Unique-violation races can happen if two runs overlap — bubble
    // the message up, runner decides whether to retry.
    throw new Error(`Prospect insert failed: ${error.message}`);
  }

  return (data ?? []).map(rowToProspect);
}

async function qualifyInlineIfRequested(
  tenantSlug: string,
  inserted: ProspectRecord[]
): Promise<number> {
  if (inserted.length === 0) return 0;
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return 0;
  const [{ voice, positioning }, filters] = await Promise.all([
    getBrandContext(tenantSlug),
    getOutboundFilters(tenantSlug),
  ]);

  const admin = createAdminClient();
  let qualified = 0;

  for (const prospect of inserted) {
    try {
      const { result } = await qualifyProspectAi({
        tenantSlug,
        tenantName: tenant.name,
        voice,
        positioning,
        filters,
        prospect,
      });
      await admin
        .from("prospects")
        .update({
          status: result.should_reach_out ? "qualified" : "unqualified",
          qualification_score: result.score,
          qualification_reason: `${result.persona} · ${result.reason}`,
          last_touched_at: new Date().toISOString(),
        })
        .eq("tenant_slug", tenantSlug)
        .eq("id", prospect.id);
      qualified += 1;
    } catch (err) {
      // Don't fail the whole run because one prospect choked. The row
      // stays as `new` and a human can re-trigger qualification.
      console.warn(
        `[discover] qualify failed for ${prospect.handle}:`,
        err instanceof OutboundAiError ? err.message : err
      );
    }
  }

  return qualified;
}

export async function executeProspectSearch(
  tenantSlug: string,
  searchId: string,
  options: RunOptions = {}
): Promise<RunSearchOutcome> {
  const maxNewPerRun = options.maxNewPerRun ?? 25;
  const qualifyInline = options.qualifyInline ?? true;
  const admin = createAdminClient();

  const { data: searchRow, error: loadErr } = await admin
    .from("prospect_searches")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("id", searchId)
    .maybeSingle();
  if (loadErr || !searchRow) {
    throw new Error(loadErr?.message ?? "Search not found");
  }
  const search = rowToSearch(searchRow);

  const outcome: RunSearchOutcome = {
    searchId,
    queryUsed: "",
    rawResultCount: 0,
    candidateCount: 0,
    insertedCount: 0,
    qualifiedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  try {
    const discovery = await runDiscoverySearch(inputFromSearch(search));
    outcome.queryUsed = discovery.queryUsed;
    outcome.rawResultCount = discovery.rawResultCount;
    outcome.candidateCount = discovery.candidates.length;
    outcome.diagnostic = discovery.diagnostic;

    const inserted = await upsertCandidates(
      tenantSlug,
      searchId,
      discovery.candidates,
      maxNewPerRun
    );
    outcome.insertedCount = inserted.length;
    outcome.skippedCount = discovery.candidates.length - inserted.length;

    if (qualifyInline && search.autoQualify && inserted.length > 0) {
      outcome.qualifiedCount = await qualifyInlineIfRequested(
        tenantSlug,
        inserted
      );
    }
  } catch (err) {
    outcome.errors.push(err instanceof Error ? err.message : String(err));
  }

  // Always update the search row's telemetry so the UI + cron see it.
  await admin
    .from("prospect_searches")
    .update({
      last_run_at: new Date().toISOString(),
      last_result_count: outcome.insertedCount,
    })
    .eq("tenant_slug", tenantSlug)
    .eq("id", searchId);

  return outcome;
}
