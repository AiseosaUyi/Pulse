// Nightly cron: scrape Tier 1 Nigerian ticketing platforms for event
// organizers, enrich with IG profile data, score by event cadence,
// and upsert into the prospects table. The backlog cron handles AI
// qualification of the newly-flagged rows (qualify_pending: true).
//
// Hardcoded to tenant "gruve" for MVP. Multi-tenant loop is deferred
// until Apify cost is validated at volume.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import {
  scrapeAllPlatforms,
  aggregateCandidates,
  enrichHandlesWithIg,
} from "@/lib/scrape/ticketing-scraper";
import { scoreEventCadence } from "@/lib/outbound/ticketing-scorer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TENANT_SLUG = "gruve";
const LIMIT_PER_PLATFORM = 50;
const MAX_TOTAL_CANDIDATES = 300;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();
  const summary = {
    scraped: 0,
    withHandle: 0,
    upserted: 0,
    errors: [] as string[],
  };

  // Ensure a permanent search record exists for this signal type
  const { data: existing } = await admin
    .from("prospect_searches")
    .select("id")
    .eq("tenant_slug", TENANT_SLUG)
    .eq("signal_type", "ticketing_platform")
    .maybeSingle();

  let searchId: string;
  if (existing) {
    searchId = existing.id as string;
  } else {
    const { data: created, error: createErr } = await admin
      .from("prospect_searches")
      .insert({
        tenant_slug: TENANT_SLUG,
        name: "Ticketing Platform Auto-Discovery",
        platform: "instagram",
        signal_type: "ticketing_platform",
        query: "all",
        filters: {},
        auto_qualify: false,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return NextResponse.json(
        { error: createErr?.message ?? "Failed to create search record" },
        { status: 500 }
      );
    }
    searchId = created.id as string;
  }

  // Step 1: Scrape all platforms
  let candidates = await scrapeAllPlatforms({ limitPerPlatform: LIMIT_PER_PLATFORM });
  summary.scraped = candidates.length;

  if (candidates.length > MAX_TOTAL_CANDIDATES) {
    console.warn(
      `[cron/scrape-ticketing-platforms] ${candidates.length} candidates exceeds cap ${MAX_TOTAL_CANDIDATES} — truncating`
    );
    candidates = candidates
      .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
      .slice(0, MAX_TOTAL_CANDIDATES);
  }

  // Step 2: Aggregate by IG handle + compute cadence counts
  const organizers = aggregateCandidates(candidates);
  summary.withHandle = organizers.size;

  if (organizers.size === 0) {
    console.log("[cron/scrape-ticketing-platforms] no handles found", summary);
    return NextResponse.json(summary);
  }

  // Step 3: Enrich handles with IG profile data
  const igProfiles = await enrichHandlesWithIg([...organizers.keys()]);

  // Step 4: Build and upsert prospect rows
  const rows: Array<Record<string, unknown>> = [];
  for (const [handle, org] of organizers) {
    const profile = igProfiles.get(handle);
    const { cadence, reachOutTiming, priorityScore } = scoreEventCadence({
      events90d: org.events90d,
      events365d: org.events365d,
      lastEventDateIso: org.lastEventDate,
    });

    rows.push({
      tenant_slug: TENANT_SLUG,
      search_id: searchId,
      platform: "instagram",
      handle,
      display_name: profile?.fullName ?? null,
      profile_url: org.igProfileUrl,
      avatar_url: profile?.profilePicUrl ?? null,
      bio: profile?.biography ?? null,
      follower_count: profile?.followersCount ?? null,
      signal_summary: `[ticketing] ${cadence} · ${org.events90d} events/90d · last: ${org.lastEventDate}`,
      signal_data: {
        source_type: "ticketing_platform",
        platform_sources: org.platformSources,
        event_cadence: cadence,
        events_90d: org.events90d,
        events_365d: org.events365d,
        last_event_date: org.lastEventDate,
        reach_out_timing: reachOutTiming,
        priority_score: priorityScore,
        qualify_pending: true,
      },
      status: "new",
    });
  }

  const { data: upserted, error: upsertErr } = await admin
    .from("prospects")
    .upsert(rows, { onConflict: "tenant_slug,platform,handle" })
    .select("id");

  if (upsertErr) {
    summary.errors.push(upsertErr.message);
    console.error("[cron/scrape-ticketing-platforms] upsert failed", upsertErr);
    return NextResponse.json(summary, { status: 500 });
  }

  summary.upserted = upserted?.length ?? 0;
  console.log("[cron/scrape-ticketing-platforms] complete", summary);
  return NextResponse.json(summary);
}
