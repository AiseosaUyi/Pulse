// Sweep prospects left with `qualify_pending: true` in signal_data
// after a bulk upload overflowed the inline budget. Runs the same
// qualifier the bulk route uses, 5 at a time per tenant, for up to
// the function's maxDuration budget.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { getOutboundFilters } from "@/lib/server/outbound-filters";
import { getTenant } from "@/lib/services/tenants";
import { qualifyProspectAi, OutboundAiError } from "@/lib/ai/outbound";
import type {
  OutboundPlatform,
  ProspectRecord,
} from "@/lib/types/outbound";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 5;
const PER_TENANT_CAP = 200;

interface TenantRow {
  slug: string;
  name: string;
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
    category: (row.category as string) ?? null,
    location: (row.location as string) ?? null,
    verifiedName: (row.verified_name as string) ?? null,
    eventTitle: (row.event_title as string) ?? null,
    lastReachoutAt: (row.last_reachout_at as string) ?? null,
    lastTouchedAt: (row.last_touched_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("qualify-backlog", async () => {
  const admin = createAdminClient();
  const summary = {
    tenantsProcessed: 0,
    qualified: 0,
    failed: 0,
    errors: [] as Array<{ tenant: string; message: string }>,
  };

  const { data: tenants, error: tenantsErr } = await admin
    .from("tenants")
    .select("slug, name");
  if (tenantsErr || !tenants) {
    throw new Error(tenantsErr?.message ?? "Failed to list tenants");
  }

  for (const tenant of tenants as TenantRow[]) {
    summary.tenantsProcessed += 1;
    try {
      const { data: rows } = await admin
        .from("prospects")
        .select("*")
        .eq("tenant_slug", tenant.slug)
        .eq("signal_data->>qualify_pending", "true")
        .is("qualification_score", null)
        .limit(PER_TENANT_CAP);

      if (!rows || rows.length === 0) continue;

      const t = await getTenant(tenant.slug);
      if (!t) continue;
      const [{ voice, positioning }, filters] = await Promise.all([
        getBrandContext(tenant.slug),
        getOutboundFilters(tenant.slug),
      ]);

      const prospects = rows.map(toProspect);
      for (let i = 0; i < prospects.length; i += CONCURRENCY) {
        const chunk = prospects.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (prospect) => {
            try {
              const { result } = await qualifyProspectAi({
                tenantSlug: tenant.slug,
                tenantName: t.name,
                voice,
                positioning,
                filters,
                prospect,
              });
              const nextStatus = result.should_reach_out
                ? "qualified"
                : "unqualified";
              await admin
                .from("prospects")
                .update({
                  status: nextStatus,
                  qualification_score: result.score,
                  qualification_reason: `${result.persona} · ${result.reason}`,
                  signal_data: {
                    ...(prospect.signalData ?? {}),
                    qualify_pending: false,
                  },
                  last_touched_at: new Date().toISOString(),
                })
                .eq("tenant_slug", tenant.slug)
                .eq("id", prospect.id);
              summary.qualified += 1;
            } catch (err) {
              summary.failed += 1;
              if (!(err instanceof OutboundAiError)) {
                summary.errors.push({
                  tenant: tenant.slug,
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }
          })
        );
      }
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({
        tenant: tenant.slug,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

    const status =
      summary.failed === 0 ? "ok" : summary.qualified > 0 ? "partial" : "failed";
    return { status, rowsProcessed: summary.qualified, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}

// Vercel Cron invokes scheduled endpoints with GET; alias the handler so
// the scheduler reaches it (previously 405ed, so these crons never ran).
export const GET = POST;
