// Bulk prospect upload. The extension's Captured tab POSTs a batch
// of locally-captured handles here. The dedup constraint on
// `prospects(tenant_slug, platform, handle)` handles duplicates —
// upsert collapses them.

import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { getOutboundFilters } from "@/lib/server/outbound-filters";
import { getTenant } from "@/lib/services/tenants";
import { qualifyProspectAi, OutboundAiError } from "@/lib/ai/outbound";
import type { OutboundPlatform, ProspectRecord } from "@/lib/types/outbound";

// Qualifier runs inline via `after()` on rows whose extension-side
// pre-score voted keep/defer. Hard cap per invocation — overflow
// rows get a `qualify_pending: true` flag in signal_data and the
// /api/cron/qualify-backlog sweep picks them up later.
const QUALIFY_INLINE_CAP = 50;
const QUALIFY_CONCURRENCY = 5;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

function pickPlatform(raw: string | null): OutboundPlatform | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "instagram" || lower === "ig") return "instagram";
  if (lower === "tiktok" || lower === "tt") return "tiktok";
  if (lower === "twitter" || lower === "x") return "twitter";
  if (lower === "linkedin" || lower === "li") return "linkedin";
  return null;
}

interface BulkItem {
  platform?: string;
  handle?: string;
  profileUrl?: string;
  displayName?: string;
  bio?: string;
  signalSummary?: string;
  signalData?: Record<string, unknown>;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const auth = await resolveApiToken(extractBearer(req) ?? "");
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  let body: { items?: BulkItem[] };
  try {
    body = (await req.json()) as { items?: BulkItem[] };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return NextResponse.json(
      { inserted: 0, updated: 0, skipped: 0, errors: ["empty batch"] },
      { status: 200, headers: CORS_HEADERS }
    );
  }
  if (rawItems.length > 200) {
    return NextResponse.json(
      { error: "batch size exceeds 200" },
      { status: 413, headers: CORS_HEADERS }
    );
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];

  for (const item of rawItems) {
    const platform = pickPlatform(item.platform ?? null);
    const rawHandle = item.handle;
    if (!platform || !rawHandle) {
      errors.push(`skipped: missing platform/handle for ${JSON.stringify(item).slice(0, 120)}`);
      continue;
    }
    const handle = normalizeHandle(rawHandle);
    if (!handle) {
      errors.push(`skipped: empty handle`);
      continue;
    }
    const dedupKey = `${platform}:${handle}`;
    if (seen.has(dedupKey)) continue; // in-batch dedup
    seen.add(dedupKey);
    rows.push({
      tenant_slug: auth.tenantSlug,
      platform,
      handle,
      display_name: item.displayName ?? null,
      profile_url: item.profileUrl ?? null,
      bio: item.bio ?? null,
      signal_summary: item.signalSummary ?? null,
      signal_data: item.signalData ?? {},
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { inserted: 0, updated: 0, skipped: rawItems.length, errors },
      { status: 200, headers: CORS_HEADERS }
    );
  }

  const admin = createAdminClient();

  // Pre-fetch existing handles so we can report insert-vs-update counts
  // honestly (upsert doesn't tell you which is which).
  const handles = rows.map((r) => r.handle as string);
  const { data: existing } = await admin
    .from("prospects")
    .select("platform, handle")
    .eq("tenant_slug", auth.tenantSlug)
    .in("handle", handles);
  const existingSet = new Set(
    (existing ?? []).map((r) => `${r.platform}:${r.handle}`)
  );

  const { data, error } = await admin
    .from("prospects")
    .upsert(rows, { onConflict: "tenant_slug,platform,handle" })
    .select("id, platform, handle");

  if (error) {
    return NextResponse.json(
      { error: error.message, errors },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  let inserted = 0;
  let updated = 0;
  for (const row of data ?? []) {
    const key = `${row.platform}:${row.handle}`;
    if (existingSet.has(key)) updated += 1;
    else inserted += 1;
  }

  // Pair the upserted prospect ids with their incoming signal_data
  // so we can decide which to qualify inline and which to mark for
  // backlog. localVerdict of "keep" or "defer" gets qualified.
  const upsertedById = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) {
    upsertedById.set(row.id as string, row);
  }
  const eligible: Array<{
    id: string;
    platform: OutboundPlatform;
    handle: string;
    verdict: string;
    matches: number;
    signalData: Record<string, unknown>;
  }> = [];
  for (const r of data ?? []) {
    const inputIdx = rows.findIndex(
      (row) => row.platform === r.platform && row.handle === r.handle
    );
    const input = inputIdx >= 0 ? rows[inputIdx] : null;
    const sd = (input?.signal_data as Record<string, unknown>) ?? {};
    const local = sd.local_qualify as
      | { verdict?: string; matchedKeywords?: string[] }
      | undefined;
    const verdict = local?.verdict ?? (sd.source_type ? "defer" : "discard");
    if (verdict === "discard") continue;
    eligible.push({
      id: r.id as string,
      platform: r.platform as OutboundPlatform,
      handle: r.handle as string,
      verdict,
      matches: local?.matchedKeywords?.length ?? 0,
      signalData: sd,
    });
  }
  eligible.sort((a, b) => b.matches - a.matches);

  const toQualifyInline = eligible.slice(0, QUALIFY_INLINE_CAP);
  const toBacklog = eligible.slice(QUALIFY_INLINE_CAP);

  if (toBacklog.length > 0) {
    // Flag backlog rows so the cron sweep can find them. Non-blocking.
    await Promise.all(
      toBacklog.map((row) =>
        admin
          .from("prospects")
          .update({
            signal_data: {
              ...(row.signalData ?? {}),
              qualify_pending: true,
            },
          })
          .eq("tenant_slug", auth.tenantSlug)
          .eq("id", row.id)
      )
    );
  }

  if (toQualifyInline.length > 0) {
    // Fire-and-forget. Next.js `after` keeps the function warm past
    // response send so the qualifier can finish without delaying the
    // client. maxDuration at top of file sets the hard ceiling.
    after(async () => {
      try {
        await qualifyRowsInline(auth.tenantSlug, toQualifyInline);
      } catch {
        // Logged inside qualifyRowsInline; don't re-raise from after().
      }
    });
  }

  return NextResponse.json(
    {
      inserted,
      updated,
      skipped: rawItems.length - rows.length,
      total: rawItems.length,
      qualifying: toQualifyInline.length,
      queued_for_later: toBacklog.length,
      errors,
    },
    { status: 200, headers: CORS_HEADERS }
  );
}

function toProspect(row: Record<string, unknown>): ProspectRecord {
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

async function qualifyRowsInline(
  tenantSlug: string,
  rows: Array<{ id: string; platform: OutboundPlatform; handle: string }>
): Promise<void> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return;
  const [{ voice, positioning }, filters] = await Promise.all([
    getBrandContext(tenantSlug),
    getOutboundFilters(tenantSlug),
  ]);
  const admin = createAdminClient();
  // Fetch the full prospect rows we need to qualify — the upsert
  // returned a sparse projection.
  const ids = rows.map((r) => r.id);
  const { data: fullRows } = await admin
    .from("prospects")
    .select("*")
    .in("id", ids)
    .eq("tenant_slug", tenantSlug);
  const prospects = (fullRows ?? []).map(toProspect);

  for (let i = 0; i < prospects.length; i += QUALIFY_CONCURRENCY) {
    const chunk = prospects.slice(i, i + QUALIFY_CONCURRENCY);
    await Promise.all(
      chunk.map(async (prospect) => {
        try {
          const { result } = await qualifyProspectAi({
            tenantSlug,
            tenantName: tenant.name,
            voice,
            positioning,
            filters,
            prospect,
          });
          const nextStatus = result.should_reach_out ? "qualified" : "unqualified";
          const nextSignal = {
            ...(prospect.signalData ?? {}),
            qualify_pending: false,
          };
          await admin
            .from("prospects")
            .update({
              status: nextStatus,
              qualification_score: result.score,
              qualification_reason: `${result.persona} · ${result.reason}`,
              signal_data: nextSignal,
              last_touched_at: new Date().toISOString(),
            })
            .eq("tenant_slug", tenantSlug)
            .eq("id", prospect.id);
        } catch (err) {
          if (!(err instanceof OutboundAiError)) {
            // Swallow — the qualifier itself logs to ai_call_log.
          }
        }
      })
    );
  }
}
