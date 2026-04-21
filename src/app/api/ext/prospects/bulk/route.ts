// Bulk prospect upload. The extension's Captured tab POSTs a batch
// of locally-captured handles here. The dedup constraint on
// `prospects(tenant_slug, platform, handle)` handles duplicates —
// upsert collapses them.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import type { OutboundPlatform } from "@/lib/types/outbound";

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

  return NextResponse.json(
    {
      inserted,
      updated,
      skipped: rawItems.length - rows.length,
      total: rawItems.length,
      errors,
    },
    { status: 200, headers: CORS_HEADERS }
  );
}
