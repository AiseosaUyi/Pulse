// Extension endpoint: fetch the tenant's primary outbound template
// for a given platform. Used by the "Copy primary" action in the
// Chrome extension so Priye can paste her bulk DM with one click.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";
import { rowToTemplate } from "@/lib/services/outbound-templates";
import type { TemplatePlatform } from "@/lib/types/outbound-templates";

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function pickPlatform(raw: string | null): TemplatePlatform {
  if (!raw) return "any";
  const lower = raw.toLowerCase();
  if (lower === "instagram" || lower === "ig") return "instagram";
  if (lower === "tiktok" || lower === "tt") return "tiktok";
  if (lower === "twitter" || lower === "x") return "twitter";
  if (lower === "linkedin" || lower === "li") return "linkedin";
  return "any";
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

  const admin = createAdminClient();
  // Prefer the exact platform's primary; fall back to `any`.
  const { data } = await admin
    .from("outbound_templates")
    .select("*")
    .eq("tenant_slug", auth.tenantSlug)
    .eq("is_primary", true)
    .in("platform", [platform, "any"])
    .order("platform", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return NextResponse.json(
      { template: null },
      { status: 200, headers: CORS_HEADERS }
    );
  }

  const template = rowToTemplate(data as Parameters<typeof rowToTemplate>[0]);
  // Return only the fields the extension needs — no critique payload.
  return NextResponse.json(
    {
      template: {
        id: template.id,
        name: template.name,
        body: template.body,
        platform: template.platform,
        score: template.score,
      },
    },
    { status: 200, headers: CORS_HEADERS }
  );
}
