import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { analyzeTrend } from "@/lib/ai/analyze-trend";
import { scrapeTikTokCreativeCenter } from "@/lib/scrape/tiktok-creative-center";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const summary = {
    tenantsProcessed: 0,
    scraped: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
    errors: [] as { tenant: string; scope: string; message: string }[],
  };

  const { data: tenants, error: tenantsErr } = await admin
    .from("tenants")
    .select("slug, name");
  if (tenantsErr || !tenants) {
    return NextResponse.json(
      { error: tenantsErr?.message ?? "Failed to list tenants" },
      { status: 500 }
    );
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const tenant of tenants) {
    summary.tenantsProcessed += 1;
    try {
      const scraped = await scrapeTikTokCreativeCenter({
        region: "NG",
        limit: 20,
      });
      summary.scraped += scraped.length;

      if (scraped.length === 0) continue;

      const voice = await getBrandVoice(tenant.slug);

      for (const trend of scraped) {
        try {
          // Idempotency: skip if same hashtag was captured this week
          const { data: existing } = await admin
            .from("trend_scouts")
            .select("id")
            .eq("tenant_slug", tenant.slug)
            .eq("source", "creative_center")
            .eq("hashtag", trend.hashtag)
            .gte("captured_at", weekAgo)
            .limit(1);
          if (existing && existing.length > 0) {
            summary.skipped += 1;
            continue;
          }

          let ai_analysis = null;
          let applicability: "high" | "medium" | "low" | "n/a" | null = null;
          try {
            const analyzed = await analyzeTrend({
              tenantSlug: tenant.slug,
              tenantName: tenant.name,
              voice,
              platform: trend.platform,
              summary: trend.summary,
              hashtag: trend.hashtag,
              metrics: {
                views: trend.views,
                trending_rank: trend.trending_rank,
                region: trend.region,
              } as Record<string, unknown>,
            });
            ai_analysis = analyzed;
            applicability = analyzed.applicability;
          } catch (aiErr) {
            console.error("[cron/scrape-trends] analyze failed", {
              tenant: tenant.slug,
              hashtag: trend.hashtag,
              message: aiErr instanceof Error ? aiErr.message : String(aiErr),
            });
          }

          const { error: insertErr } = await admin.from("trend_scouts").insert({
            tenant_slug: tenant.slug,
            platform: trend.platform,
            source: "creative_center",
            hashtag: trend.hashtag,
            external_url: trend.external_url ?? null,
            title: trend.title,
            summary: trend.summary,
            metrics: {
              views: trend.views,
              trending_rank: trend.trending_rank,
              region: trend.region,
            },
            ai_analysis,
            applicability,
          });
          if (insertErr) throw insertErr;
          summary.inserted += 1;
        } catch (trendErr) {
          summary.failed += 1;
          const message =
            trendErr instanceof Error ? trendErr.message : String(trendErr);
          console.error("[cron/scrape-trends] trend insert failed", {
            tenant: tenant.slug,
            hashtag: trend.hashtag,
            message,
          });
          summary.errors.push({
            tenant: tenant.slug,
            scope: `trend:${trend.hashtag}`,
            message,
          });
        }
      }
    } catch (tenantErr) {
      summary.failed += 1;
      const message =
        tenantErr instanceof Error ? tenantErr.message : String(tenantErr);
      console.error("[cron/scrape-trends] tenant failure", {
        tenant: tenant.slug,
        message,
      });
      summary.errors.push({ tenant: tenant.slug, scope: "tenant", message });
    }
  }

  console.log("[cron/scrape-trends] complete", summary);
  return NextResponse.json(summary);
}
