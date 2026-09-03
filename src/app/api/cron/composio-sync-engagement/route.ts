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
import { maybeAutoReply } from "@/lib/ai/shared-inbox-auto-reply";

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
    // Tracks upsert failures that return {error} without throwing — a
    // thrown exception already skips the last_synced_at advance below via
    // the catch block, but a per-row upsert error previously didn't, so a
    // partially-failed run could still mark itself fully synced and strand
    // whatever failed with no retry and no alert. See docs/ACTION-QUEUE-BRIEF.md §2.2.
    let itemErrors = 0;

    try {
      // Comments — fetch recent media, then comments per media.
      const media = await getInstagramRecentMedia(conn, MEDIA_LOOKBACK);
      for (const m of media) {
        const comments = await getInstagramMediaComments(conn, m.id);
        for (const c of comments) {
          if (since && new Date(c.timestamp).getTime() <= since) continue;

          const commentMeta = { media_id: c.mediaId, parent_id: c.parentId };
          const { data: commentRow, error } = await admin
            .from("engagement_items")
            .upsert(
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
                received_at: c.timestamp,
                meta: commentMeta,
              },
              { onConflict: "tenant_slug,platform,external_id" }
            )
            .select("id")
            .single();
          if (error) itemErrors += 1;
          if (!error) {
            summary.commentsAdded += 1;
            // Track A Phase 3 — merged-but-inert (see maybeAutoReply's own
            // gates: per-tenant opt-in + global kill switch). Best-effort:
            // a drafting/sending failure must never fail the sync cron.
            if (commentRow?.id) {
              try {
                await maybeAutoReply({
                  source: "engagement",
                  id: commentRow.id,
                  tenantSlug: conn.tenantSlug,
                  platform: "instagram",
                  type: "comment",
                  content: c.text,
                  fromHandle: c.username ?? null,
                  externalId: c.id,
                  meta: commentMeta,
                  receivedAt: c.timestamp,
                });
              } catch {
                // Best-effort — the comment itself is already persisted.
              }
            }
          }
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

          const dmMeta = { conversation_id: convo.id, sender_id: msg.fromId };
          const { data: dmRow, error: engErr } = await admin
            .from("engagement_items")
            .upsert(
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
                received_at: msg.createdAt,
                meta: dmMeta,
              },
              { onConflict: "tenant_slug,platform,external_id" }
            )
            .select("id")
            .single();
          if (engErr) itemErrors += 1;
          if (!engErr) {
            summary.dmsAdded += 1;
            // Track A Phase 3 — see the comment loop above for the same
            // merged-but-inert reasoning. This is the engagement_items DM
            // row only, not the separate prospect-linked inbound_messages
            // upsert below it (that pipeline belongs to Outbound, not the
            // shared inbox — see conversations.ts's sourceForPlatform).
            if (dmRow?.id) {
              try {
                await maybeAutoReply({
                  source: "engagement",
                  id: dmRow.id,
                  tenantSlug: conn.tenantSlug,
                  platform: "instagram",
                  type: "dm",
                  content: msg.message,
                  fromHandle: msg.fromHandle ?? null,
                  externalId: msg.id,
                  meta: dmMeta,
                  receivedAt: msg.createdAt,
                });
              } catch {
                // Best-effort — the DM row itself is already persisted.
              }
            }
          }

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

      if (itemErrors === 0) {
        // 24h overlap window, not the exact sync moment — a comment/DM
        // that lands in the gap between "we read the platform" and "we
        // wrote the row" would otherwise be skipped forever once the
        // watermark passes it. uq_engagement_items_external makes
        // re-scanning the overlap idempotent (upsert, not insert).
        const overlapWatermark = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        await admin
          .from("connected_accounts")
          .update({ last_synced_at: overlapWatermark, last_error: null })
          .eq("id", conn.id);
      } else {
        // Leave last_synced_at untouched so the next run re-scans this
        // same window instead of silently stranding whatever failed.
        summary.failed += 1;
        await admin
          .from("connected_accounts")
          .update({ last_error: `${itemErrors} item(s) failed to sync` })
          .eq("id", conn.id);
      }
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

// Vercel Cron invokes scheduled endpoints with GET; alias the handler so
// the scheduler reaches it (previously 405ed, so these crons never ran).
export const GET = POST;
