import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { analyzeTrend } from "@/lib/ai/analyze-trend";
import {
  scrapeTikTokCreativeCenter,
  type ScrapedTrend,
} from "@/lib/scrape/tiktok-creative-center";
import { scrapeInstagramTopPosts } from "@/lib/scrape/instagram-hashtag";
import type { BrandVoice } from "@/lib/ai/brand-voice";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ScoutConfig {
  instagram_hashtags?: string[];
  tiktok_region?: string;
}

interface TenantRow {
  slug: string;
  name: string;
  settings: { scout_config?: ScoutConfig } | null;
}

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
    .select("slug, name, settings");
  if (tenantsErr || !tenants) {
    return NextResponse.json(
      { error: tenantsErr?.message ?? "Failed to list tenants" },
      { status: 500 }
    );
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const tenant of tenants as TenantRow[]) {
    summary.tenantsProcessed += 1;
    try {
      const scoutConfig = tenant.settings?.scout_config ?? {};
      const voice = await getBrandVoice(tenant.slug);

      // TikTok Creative Center — region-based
      if (scoutConfig.tiktok_region) {
        const tiktokTrends = await scrapeTikTokCreativeCenter({
          region: scoutConfig.tiktok_region,
          limit: 20,
        });
        summary.scraped += tiktokTrends.length;
        await persistTrends(tenant, voice, tiktokTrends, summary, {
          idempotencyMode: "hashtag_week",
          weekAgoIso: weekAgo,
        });
      }

      // Instagram top posts — hashtag-based, per tenant
      if (
        scoutConfig.instagram_hashtags &&
        scoutConfig.instagram_hashtags.length > 0
      ) {
        const igPosts = await scrapeInstagramTopPosts(
          scoutConfig.instagram_hashtags,
          { limitPerHashtag: 5 }
        );
        summary.scraped += igPosts.length;
        await persistTrends(tenant, voice, igPosts, summary, {
          idempotencyMode: "url",
        });
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

type IdempotencyMode = "hashtag_week" | "url";

async function persistTrends(
  tenant: TenantRow,
  voice: BrandVoice | null,
  scraped: ScrapedTrend[],
  summary: {
    inserted: number;
    skipped: number;
    failed: number;
    errors: { tenant: string; scope: string; message: string }[];
  },
  opts: { idempotencyMode: IdempotencyMode; weekAgoIso?: string }
): Promise<void> {
  const admin = createAdminClient();

  for (const trend of scraped) {
    try {
      // Idempotency
      let alreadyExists = false;
      if (opts.idempotencyMode === "url" && trend.external_url) {
        const { data } = await admin
          .from("trend_scouts")
          .select("id")
          .eq("tenant_slug", tenant.slug)
          .eq("external_url", trend.external_url)
          .limit(1);
        alreadyExists = !!(data && data.length > 0);
      } else if (
        opts.idempotencyMode === "hashtag_week" &&
        trend.hashtag &&
        opts.weekAgoIso
      ) {
        const { data } = await admin
          .from("trend_scouts")
          .select("id")
          .eq("tenant_slug", tenant.slug)
          .eq("source", trend.source)
          .eq("hashtag", trend.hashtag)
          .gte("captured_at", opts.weekAgoIso)
          .limit(1);
        alreadyExists = !!(data && data.length > 0);
      }
      if (alreadyExists) {
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
            likes: trend.likes,
            comments: trend.comments,
            engagement_rate: trend.engagement_rate,
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
        source: trend.source,
        hashtag: trend.hashtag ?? null,
        external_url: trend.external_url ?? null,
        title: trend.title,
        summary: trend.summary,
        metrics: {
          views: trend.views,
          likes: trend.likes,
          comments: trend.comments,
          engagement_rate: trend.engagement_rate,
          trending_rank: trend.trending_rank,
          region: trend.region,
          owner_handle: trend.owner_handle,
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
        url: trend.external_url,
        message,
      });
      summary.errors.push({
        tenant: tenant.slug,
        scope: `trend:${trend.hashtag ?? trend.external_url ?? "?"}`,
        message,
      });
    }
  }
}
