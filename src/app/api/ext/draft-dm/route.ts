// Extension endpoint: upsert a prospect and draft a DM in one call.
// The extension calls this when the operator hits "Draft with Pulse"
// on an IG / TikTok profile page.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { draftOutboundDmAi, OutboundAiError } from "@/lib/ai/outbound";
import type {
  OutboundPlatform,
  ProspectRecord,
} from "@/lib/types/outbound";

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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const platform = pickPlatform((body.platform as string) ?? null);
  const handle = body.handle as string | undefined;
  if (!platform || !handle) {
    return NextResponse.json(
      { error: "platform and handle required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const tenant = await getTenant(auth.tenantSlug);
  if (!tenant) {
    return NextResponse.json(
      { error: "Tenant not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  const admin = createAdminClient();

  // Upsert the prospect first so context flows into the draft.
  const { data: prospectRow, error: upsertError } = await admin
    .from("prospects")
    .upsert(
      {
        tenant_slug: auth.tenantSlug,
        platform,
        handle: normalizeHandle(handle),
        display_name: (body.displayName as string) ?? null,
        profile_url: (body.profileUrl as string) ?? null,
        bio: (body.bio as string) ?? null,
        follower_count: (body.followerCount as number) ?? null,
        signal_summary: (body.signalSummary as string) ?? null,
      },
      { onConflict: "tenant_slug,platform,handle" }
    )
    .select("*")
    .single();
  if (upsertError || !prospectRow) {
    return NextResponse.json(
      { error: upsertError?.message ?? "Prospect upsert failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const prospect: ProspectRecord = {
    id: prospectRow.id,
    tenantSlug: prospectRow.tenant_slug,
    searchId: prospectRow.search_id,
    platform: prospectRow.platform,
    handle: prospectRow.handle,
    displayName: prospectRow.display_name,
    profileUrl: prospectRow.profile_url,
    avatarUrl: prospectRow.avatar_url,
    bio: prospectRow.bio,
    followerCount: prospectRow.follower_count,
    signalSummary: prospectRow.signal_summary,
    signalData: (prospectRow.signal_data ?? {}) as Record<string, unknown>,
    qualificationScore: prospectRow.qualification_score,
    qualificationReason: prospectRow.qualification_reason,
    status: prospectRow.status,
    quality: prospectRow.quality ?? "unscored",
    duplicateOfId: prospectRow.duplicate_of_id ?? null,
    notes: prospectRow.notes,
    category: prospectRow.category ?? null,
    location: prospectRow.location ?? null,
    verifiedName: prospectRow.verified_name ?? null,
    eventTitle: prospectRow.event_title ?? null,
    phone: prospectRow.phone ?? null,
    lastReachoutAt: prospectRow.last_reachout_at ?? null,
    lastTouchedAt: prospectRow.last_touched_at,
    createdAt: prospectRow.created_at,
    updatedAt: prospectRow.updated_at,
  };

  try {
    const { voice, positioning } = await getBrandContext(auth.tenantSlug);
    const { result, model, costUsd } = await draftOutboundDmAi({
      tenantSlug: auth.tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      prospect,
      context: (body.context as string) ?? undefined,
    });

    // Latest version + 1.
    const { data: last } = await admin
      .from("outbound_dms")
      .select("version")
      .eq("tenant_slug", auth.tenantSlug)
      .eq("prospect_id", prospect.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((last?.version as number | null) ?? 0) + 1;

    const { data: dmRow, error: dmError } = await admin
      .from("outbound_dms")
      .insert({
        tenant_slug: auth.tenantSlug,
        prospect_id: prospect.id,
        version: nextVersion,
        body: result.body,
        followup_body: result.followup_body,
        status: "drafted",
        generator_model: model,
        generator_cost_usd: costUsd,
      })
      .select("*")
      .single();
    if (dmError || !dmRow) {
      return NextResponse.json(
        { error: dmError?.message ?? "DM save failed" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    await admin
      .from("prospects")
      .update({ status: "drafted", last_touched_at: new Date().toISOString() })
      .eq("tenant_slug", auth.tenantSlug)
      .eq("id", prospect.id);

    return NextResponse.json(
      {
        prospect: { ...prospect, status: "drafted" },
        dm: {
          id: dmRow.id,
          version: dmRow.version,
          body: dmRow.body,
          followupBody: dmRow.followup_body,
          status: dmRow.status,
          rationale: result.rationale,
        },
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    const msg =
      err instanceof OutboundAiError
        ? "DM draft failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
