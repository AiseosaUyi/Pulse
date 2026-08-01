// Hourly cron: pulls daily performance rows for every active ad account
// across all three levels (campaign/adset/ad) and upserts into
// ad_insights_daily. Runs a rolling 3-day window every time (not just
// "today") because Meta/TikTok both revise attribution for 24-72h after a
// click — re-pulling recent days catches those revisions instead of
// freezing a post's numbers the moment it's first synced.

import { createAdminClient } from "@/lib/supabase/admin";
import { listActiveAdAccounts, markAdAccountSynced, markAdAccountSyncError } from "@/lib/services/ad-accounts";
import { upsertInsightRows } from "@/lib/services/ads-sync";
import { resolveConnectionById } from "@/lib/composio/resolve-alias";
import { getMetaInsights } from "@/lib/composio/ads-executors";
import { decryptToken } from "@/lib/integrations/platform-crypto";
import { getTikTokInsights } from "@/lib/integrations/tiktok-ads";
import type { AdInsightsLevel } from "@/lib/types/ads-platform";

export const maxDuration = 300;

const LEVELS: AdInsightsLevel[] = ["campaign", "adset", "ad"];
const REVISION_WINDOW_DAYS = 3;

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function syncMetaInsights(
  tenantSlug: string,
  adAccountId: string,
  externalAccountId: string,
  connectedAccountId: string | null,
  since: string,
  until: string,
  currency: string
): Promise<void> {
  if (!connectedAccountId) throw new Error("Meta ad account has no connected_account_id");
  const conn = await resolveConnectionById(connectedAccountId);
  if (!conn) throw new Error("Meta connection is no longer active");

  for (const level of LEVELS) {
    const rows = await getMetaInsights(conn, externalAccountId, level, since, until, currency);
    await upsertInsightRows(tenantSlug, adAccountId, rows);
  }
}

async function syncTikTokInsights(
  tenantSlug: string,
  adAccountId: string,
  externalAccountId: string,
  tiktokConnectionId: string | null,
  since: string,
  until: string,
  currency: string
): Promise<void> {
  if (!tiktokConnectionId) throw new Error("TikTok ad account has no tiktok_connection_id");
  const admin = createAdminClient();
  const { data: connRow } = await admin
    .from("tiktok_ads_connections")
    .select("access_token_enc, status")
    .eq("id", tiktokConnectionId)
    .maybeSingle();
  if (!connRow || connRow.status !== "active") throw new Error("TikTok connection is no longer active");
  const accessToken = decryptToken(connRow.access_token_enc);

  for (const level of LEVELS) {
    const rows = await getTikTokInsights(accessToken, externalAccountId, level, since, until, currency);
    await upsertInsightRows(tenantSlug, adAccountId, rows);
  }
}

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const until = dateStr(new Date());
  const since = dateStr(new Date(Date.now() - REVISION_WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const accounts = await listActiveAdAccounts();
  let synced = 0;
  let errors = 0;

  for (const acc of accounts) {
    try {
      if (acc.platform === "meta") {
        const admin = createAdminClient();
        const { data } = await admin.from("ad_accounts").select("connected_account_id").eq("id", acc.id).single();
        await syncMetaInsights(acc.tenantSlug, acc.id, acc.externalAccountId, data?.connected_account_id ?? null, since, until, acc.currency);
      } else {
        const admin = createAdminClient();
        const { data } = await admin.from("ad_accounts").select("tiktok_connection_id").eq("id", acc.id).single();
        await syncTikTokInsights(acc.tenantSlug, acc.id, acc.externalAccountId, data?.tiktok_connection_id ?? null, since, until, acc.currency);
      }
      await markAdAccountSynced(acc.id, "insights");
      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[sync-ad-insights] failed for account", acc.id, msg);
      await markAdAccountSyncError(acc.id, msg);
      errors++;
    }
  }

  return Response.json({ synced, errors, total: accounts.length, since, until });
}
