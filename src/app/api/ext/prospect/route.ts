// Extension endpoint: look up or create a prospect by (platform, handle).
// Returns the prospect, latest drafted DM (if any), and a Pulse URL
// the operator can hit to manage them. Token-auth only — no cookies.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import type {
  OutboundDmRecord,
  OutboundPlatform,
  ProspectRecord,
} from "@/lib/types/outbound";

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    notes: (row.notes as string) ?? null,
    lastTouchedAt: (row.last_touched_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

async function latestDm(
  tenantSlug: string,
  prospectId: string
): Promise<OutboundDmRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("outbound_dms")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .eq("prospect_id", prospectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    tenantSlug: data.tenant_slug,
    prospectId: data.prospect_id,
    version: data.version,
    body: data.body,
    followupBody: data.followup_body,
    status: data.status,
    approvedBy: data.approved_by,
    approvedAt: data.approved_at,
    sentAt: data.sent_at,
    externalId: data.external_id,
    error: data.error,
    generatorModel: data.generator_model,
    generatorCostUsd: Number(data.generator_cost_usd ?? 0),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const auth = await resolveApiToken(extractBearer(req) ?? "");
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const { searchParams } = new URL(req.url);
  const platform = pickPlatform(searchParams.get("platform"));
  const handle = searchParams.get("handle");
  if (!platform || !handle) {
    return NextResponse.json(
      { error: "platform and handle query params required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("prospects")
    .select("*")
    .eq("tenant_slug", auth.tenantSlug)
    .eq("platform", platform)
    .eq("handle", normalizeHandle(handle))
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  if (!data) {
    return NextResponse.json(
      { prospect: null, dm: null },
      { status: 200, headers: CORS_HEADERS }
    );
  }
  const prospect = toProspect(data);
  const dm = await latestDm(auth.tenantSlug, prospect.id);
  return NextResponse.json(
    { prospect, dm },
    { status: 200, headers: CORS_HEADERS }
  );
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

  const admin = createAdminClient();
  const { data, error } = await admin
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

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Insert failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const prospect = toProspect(data);
  const dm = await latestDm(auth.tenantSlug, prospect.id);
  return NextResponse.json(
    { prospect, dm },
    { status: 200, headers: CORS_HEADERS }
  );
}
