// Extension endpoint: mark a drafted DM as sent. Cascades the
// prospect's pipeline stage to `sent`. No-op if the DM doesn't
// belong to the caller's tenant — surfaces as 404.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearer, resolveApiToken } from "@/lib/api-tokens";

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await resolveApiToken(extractBearer(req) ?? "");
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const { id } = await ctx.params;
  const admin = createAdminClient();
  const { data: dm, error: loadError } = await admin
    .from("outbound_dms")
    .select("id, prospect_id, tenant_slug")
    .eq("tenant_slug", auth.tenantSlug)
    .eq("id", id)
    .maybeSingle();
  if (loadError || !dm) {
    return NextResponse.json(
      { error: "DM not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  const nowIso = new Date().toISOString();
  await admin
    .from("outbound_dms")
    .update({ status: "sent", sent_at: nowIso })
    .eq("tenant_slug", auth.tenantSlug)
    .eq("id", dm.id);
  await admin
    .from("prospects")
    .update({ status: "sent", last_touched_at: nowIso })
    .eq("tenant_slug", auth.tenantSlug)
    .eq("id", dm.prospect_id);

  return NextResponse.json(
    { success: true },
    { status: 200, headers: CORS_HEADERS }
  );
}
