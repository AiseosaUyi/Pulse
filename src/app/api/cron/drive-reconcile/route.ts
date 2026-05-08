// Nightly Drive reconciliation. For every tenant with an active
// Drive connection:
//   - batch-fetch metadata for all content_items
//   - mark missing files drive_status='missing'
//   - mark permission-lost files drive_status='permission_lost'
//   - flip rows back to 'ok' if Drive recovered them
//   - refresh drive_web_view_link if it changed
//
// Bearer-auth via CRON_SECRET (Pulse's standard pattern). Caps tenant
// concurrency at 1 — sequential, since the bottleneck is Drive's
// per-user quota, not CPU.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { batchGetFiles, DriveError } from "@/lib/integrations/drive";
import { getActiveAccessToken } from "@/lib/services/drive-connections";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface TenantRow {
  tenant_slug: string;
}

interface ItemRow {
  id: string;
  drive_file_id: string;
  drive_status: string;
  drive_web_view_link: string | null;
  title: string;
}

export async function POST(req: Request): Promise<Response> {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();
  const summary = {
    tenantsProcessed: 0,
    tenantsFailed: 0,
    itemsChecked: 0,
    markedMissing: 0,
    restoredOk: 0,
  };

  const { data: tenants, error: tErr } = await admin
    .from("tenant_drive_connections")
    .select("tenant_slug")
    .eq("status", "active");
  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }
  if (!tenants || tenants.length === 0) {
    return NextResponse.json({ ok: true, summary });
  }

  for (const t of tenants as TenantRow[]) {
    try {
      let accessToken: string;
      try {
        const tok = await getActiveAccessToken(t.tenant_slug);
        accessToken = tok.accessToken;
      } catch {
        // Connection is broken — skip this tenant; getActiveAccessToken
        // already marked it revoked if applicable
        summary.tenantsFailed++;
        continue;
      }

      const { data: items } = await admin
        .from("content_items")
        .select("id, drive_file_id, drive_status, drive_web_view_link, title")
        .eq("tenant_slug", t.tenant_slug);
      if (!items || items.length === 0) {
        summary.tenantsProcessed++;
        continue;
      }

      const driveIds = (items as ItemRow[]).map((r) => r.drive_file_id);
      const meta = await batchGetFiles(accessToken, driveIds);
      summary.itemsChecked += driveIds.length;

      for (const row of items as ItemRow[]) {
        const m = meta.get(row.drive_file_id);
        // batchGetFiles maps auth_revoked errors out (those throw),
        // and returns null for 404 / permission_denied alike — we
        // surface 'missing' for either since the user-visible
        // outcome is the same: row not viewable.
        let nextStatus: "ok" | "missing" | "permission_lost" =
          row.drive_status as "ok" | "missing" | "permission_lost";
        let nextLink: string | null = row.drive_web_view_link;

        if (m === null) {
          nextStatus = "missing";
        } else if (m === undefined) {
          // Network failure mid-batch; leave as-is
          continue;
        } else if (m.trashed) {
          nextStatus = "missing";
        } else {
          nextStatus = "ok";
          nextLink = m.webViewLink ?? row.drive_web_view_link;
        }

        if (
          nextStatus !== row.drive_status ||
          nextLink !== row.drive_web_view_link
        ) {
          await admin
            .from("content_items")
            .update({
              drive_status: nextStatus,
              drive_web_view_link: nextLink,
            })
            .eq("id", row.id);

          if (nextStatus === "missing" && row.drive_status !== "missing") {
            summary.markedMissing++;
          } else if (nextStatus === "ok" && row.drive_status !== "ok") {
            summary.restoredOk++;
          }
        }
      }

      summary.tenantsProcessed++;
    } catch (err) {
      summary.tenantsFailed++;
      // Auth-revoked errors already mark the connection; anything
      // else we just count and move on
      if (!(err instanceof DriveError && err.reason === "auth_revoked")) {
        console.error("drive-reconcile tenant failed", t.tenant_slug, err);
      }
    }
  }

  return NextResponse.json({ ok: true, summary });
}
