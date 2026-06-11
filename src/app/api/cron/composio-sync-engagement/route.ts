// Pulls fresh IG comments + DMs into engagement_items / inbound_messages.
// Iterates every active connected_accounts row where toolkit='instagram'
// and calls the Composio executors. New rows are deduplicated by
// (tenant_slug, platform, external_id).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { listActiveConnections } from "@/lib/composio/resolve-alias";
import {
  getInstagramRecentMedia,
  getInstagramMediaComments,
  listInstagramConversations,
  listInstagramMessages,
} from "@/lib/composio/executors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MEDIA_LOOKBACK = 25;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("composio-sync-engagement", async () => {
  const admin = createAdminClient();
  const summary = {
    connectionsProcessed: 0,
    commentsAdded: 0,
    dmsAdded: 0,
    failed: 0,
    errors: [] as { tenant: string; alias: string; message: string }[],
  };

  const connections = await listActiveConnections("instagram");

  for (const conn of connections) {
    summary.connectionsProcessed += 1;
    const since = conn.lastSyncedAt
      ? new Date(conn.lastSyncedAt).getTime()
      : 0;

    try {
      // Comments — fetch recent media, then comments per media.
      const media = await getInstagramRecentMedia(conn, MEDIA_LOOKBACK);
      for (const m of media) {
        const comments = await getInstagramMediaComments(conn, m.id);
        for (const c of comments) {
          if (since && new Date(c.timestamp).getTime() <= since) continue;

          const { error } = await admin.from("engagement_items").upsert(
            {
              tenant_slug: conn.tenantSlug,
              type: "comment",
              platform: "instagram",
              external_id: c.id,
              source: "composio",
              from_name: c.username ?? "Instagram user",
              from_handle: c.username,
              content: c.text,
              read: false,
              replied: false,
              created_at: c.timestamp,
              meta: { media_id: c.mediaId, parent_id: c.parentId },
            },
            { onConflict: "tenant_slug,platform,external_id" }
          );
          if (!error) summary.commentsAdded += 1;
        }
      }

      // DMs — list conversations, then messages per conversation.
      const conversations = await listInstagramConversations(conn);
      for (const convo of conversations) {
        if (since && new Date(convo.updatedAt).getTime() <= since) continue;

        const messages = await listInstagramMessages(conn, convo.id);
        for (const msg of messages) {
          if (since && new Date(msg.createdAt).getTime() <= since) continue;
          // Don't ingest our own outbound messages.
          if (msg.fromHandle === conn.userHandle) continue;

          const { error: engErr } = await admin.from("engagement_items").upsert(
            {
              tenant_slug: conn.tenantSlug,
              type: "dm",
              platform: "instagram",
              external_id: msg.id,
              source: "composio",
              from_name: msg.fromHandle ?? "Instagram user",
              from_handle: msg.fromHandle,
              content: msg.message,
              read: false,
              replied: false,
              created_at: msg.createdAt,
              meta: { conversation_id: convo.id, sender_id: msg.fromId },
            },
            { onConflict: "tenant_slug,platform,external_id" }
          );
          if (!engErr) summary.dmsAdded += 1;

          // Best-effort linkage to a known prospect by handle.
          if (msg.fromHandle) {
            const { data: prospect } = await admin
              .from("prospects")
              .select("id")
              .eq("tenant_slug", conn.tenantSlug)
              .eq("platform", "instagram")
              .eq("handle", msg.fromHandle)
              .maybeSingle();

            if (prospect) {
              await admin.from("inbound_messages").upsert(
                {
                  tenant_slug: conn.tenantSlug,
                  prospect_id: prospect.id,
                  platform: "instagram",
                  external_id: msg.id,
                  body: msg.message,
                  received_at: msg.createdAt,
                },
                { onConflict: "tenant_slug,platform,external_id" }
              );
            }
          }
        }
      }

      await admin
        .from("connected_accounts")
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", conn.id);
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : "unknown";
      summary.errors.push({
        tenant: conn.tenantSlug,
        alias: conn.alias,
        message,
      });
      await admin
        .from("connected_accounts")
        .update({ last_error: message })
        .eq("id", conn.id);
    }
  }

    const ingested = summary.commentsAdded + summary.dmsAdded;
    const status =
      summary.failed === 0
        ? "ok"
        : ingested > 0 || summary.connectionsProcessed > summary.failed
          ? "partial"
          : "failed";
    return { status, rowsProcessed: ingested, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}
