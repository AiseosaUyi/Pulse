// TikTok has no native creative-fatigue signal (Meta pushes one via
// webhook — see /api/webhooks/meta-ads). Derived here from insights trend
// using the thresholds documented in PULSE-ADS-SPEC research: sustained
// CTR decline of 20-25%+ over a 3-day window, combined with frequency
// crossing ~2.5 (the first fatigue zone for prospecting/broad audiences).
// Runs after sync-ad-insights so the day's numbers are already fresh.

import { createAdminClient } from "@/lib/supabase/admin";
import { createAdAlert } from "@/lib/services/ad-alerts";

export const maxDuration = 120;

const CTR_DECLINE_THRESHOLD = 0.2; // 20%
const FREQUENCY_THRESHOLD = 2.5;
const WINDOW_DAYS = 3;

interface AdInsightRow {
  ad_account_id: string;
  external_id: string;
  date: string;
  ctr: number | null;
  frequency: number | null;
  spend: number;
}

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: tiktokAccounts } = await admin.from("ad_accounts").select("id, tenant_slug").eq("platform", "tiktok").eq("status", "active");
  if (!tiktokAccounts || tiktokAccounts.length === 0) {
    return Response.json({ flagged: 0, checked: 0 });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let flagged = 0;
  let checked = 0;

  for (const account of tiktokAccounts) {
    const { data: rows } = await admin
      .from("ad_insights_daily")
      .select("ad_account_id, external_id, date, ctr, frequency, spend")
      .eq("ad_account_id", account.id)
      .eq("level", "ad")
      .gte("date", since)
      .order("date", { ascending: true });

    const byAd = new Map<string, AdInsightRow[]>();
    for (const r of (rows ?? []) as AdInsightRow[]) {
      const list = byAd.get(r.external_id) ?? [];
      list.push(r);
      byAd.set(r.external_id, list);
    }

    for (const [adExternalId, series] of byAd) {
      checked++;
      if (series.length < WINDOW_DAYS) continue; // not enough history

      const first = series[0];
      const latest = series[series.length - 1];
      if (first.ctr == null || latest.ctr == null || first.ctr === 0) continue;
      // Only worth flagging if there's been meaningful spend — a near-zero-
      // spend ad's CTR swings on tiny sample size, not real fatigue.
      const totalSpend = series.reduce((s, r) => s + r.spend, 0);
      if (totalSpend < 10) continue;

      const ctrDecline = (first.ctr - latest.ctr) / first.ctr;
      const frequencyHigh = (latest.frequency ?? 0) >= FREQUENCY_THRESHOLD;

      if (ctrDecline >= CTR_DECLINE_THRESHOLD && frequencyHigh) {
        await createAdAlert({
          tenantSlug: account.tenant_slug,
          adAccountId: account.id,
          level: "ad",
          externalId: adExternalId,
          alertType: "creative_fatigue",
          severity: ctrDecline >= 0.35 ? "high" : "medium",
          message: `CTR down ${Math.round(ctrDecline * 100)}% over ${WINDOW_DAYS} days with frequency at ${latest.frequency?.toFixed(1)} — likely creative fatigue.`,
          raw: { firstCtr: first.ctr, latestCtr: latest.ctr, frequency: latest.frequency },
        });
        flagged++;
      }
    }
  }

  return Response.json({ flagged, checked });
}
