import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { analyzeTrend } from "@/lib/ai/analyze-trend";
import {
  scrapeTikTokTopPosts,
  type ScrapedTrend,
} from "@/lib/scrape/tiktok-creative-center";
import { scrapeInstagramTopPosts } from "@/lib/scrape/instagram-hashtag";
import type { BrandVoice } from "@/lib/ai/brand-voice";
import type { TrendApplicability } from "@/lib/types/trends";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ScoutConfig {
  instagram_hashtags?: string[];
  tiktok_hashtags?: string[];
}

interface TenantRow {
  slug: string;
  name: string;
  settings: { scout_config?: ScoutConfig } | null;
}

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const admin = createAdminClient();
  const summary = {
    tenantsProcessed: 0,
    scraped: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
    errors: [] as { tenant: string; scope: string; message: string }[],
    debug: {
      hasApifyToken: !!process.env.APIFY_API_TOKEN,
      tiktokActorId: process.env.APIFY_TIKTOK_ACTOR_ID ?? null,
      instagramActorId: process.env.APIFY_INSTAGRAM_ACTOR_ID ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown",
      scrapeJobsQueued: 0,
    },
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

  // Phase 1: scrape all platforms all tenants in parallel.
  interface ScrapeJob {
    tenant: TenantRow;
    platform: "tiktok" | "instagram";
    trends: ScrapedTrend[];
    error?: string;
  }

  const scrapeJobs: Promise<ScrapeJob>[] = [];
  for (const tenant of tenants as TenantRow[]) {
    summary.tenantsProcessed += 1;
    const cfg = tenant.settings?.scout_config ?? {};
    if (cfg.tiktok_hashtags && cfg.tiktok_hashtags.length > 0) {
      scrapeJobs.push(
        scrapeTikTokTopPosts(cfg.tiktok_hashtags, { limitPerHashtag: 5 })
          .then((trends) => ({ tenant, platform: "tiktok" as const, trends }))
          .catch((err) => ({
            tenant,
            platform: "tiktok" as const,
            trends: [],
            error: err instanceof Error ? err.message : String(err),
          }))
      );
    }
    if (cfg.instagram_hashtags && cfg.instagram_hashtags.length > 0) {
      scrapeJobs.push(
        scrapeInstagramTopPosts(cfg.instagram_hashtags, { limitPerHashtag: 5 })
          .then((trends) => ({ tenant, platform: "instagram" as const, trends }))
          .catch((err) => ({
            tenant,
            platform: "instagram" as const,
            trends: [],
            error: err instanceof Error ? err.message : String(err),
          }))
      );
    }
  }

  summary.debug.scrapeJobsQueued = scrapeJobs.length;
  const scrapeResults = await Promise.all(scrapeJobs);
  const jobSummaries: Array<{
    tenant: string;
    platform: string;
    trendsReturned: number;
    error?: string;
  }> = [];
  for (const job of scrapeResults) {
    jobSummaries.push({
      tenant: job.tenant.slug,
      platform: job.platform,
      trendsReturned: job.trends.length,
      error: job.error,
    });
    if (job.error) {
      summary.failed += 1;
      summary.errors.push({
        tenant: job.tenant.slug,
        scope: `scrape:${job.platform}`,
        message: job.error,
      });
      console.error(
        `[cron/scrape-trends] scrape failed`,
        { tenant: job.tenant.slug, platform: job.platform, message: job.error }
      );
    }
    summary.scraped += job.trends.length;
  }
  (summary.debug as Record<string, unknown>).jobs = jobSummaries;

  // Phase 2: per job, analyze + persist. AI calls in parallel within a job.
  for (const job of scrapeResults) {
    if (job.trends.length === 0) continue;
    try {
      const voice = await getBrandVoice(job.tenant.slug);

      // Analyze all trends in parallel
      const analyses = await Promise.allSettled(
        job.trends.map((trend) =>
          analyzeTrend({
            tenantSlug: job.tenant.slug,
            tenantName: job.tenant.name,
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
          })
        )
      );

      // Persist sequentially (DB is fast). No URL-based dedup — we want
      // each day's top-N to resurface even if the same post appeared
      // yesterday. Manual dismiss handles cleanup per design.
      for (let i = 0; i < job.trends.length; i++) {
        const trend = job.trends[i];
        const analysis = analyses[i];
        try {
          let ai_analysis = null;
          let applicability: TrendApplicability | null = null;
          if (analysis.status === "fulfilled") {
            ai_analysis = analysis.value;
            applicability = analysis.value.applicability;
          }

          const { error: insertErr } = await admin
            .from("trend_scouts")
            .insert({
              tenant_slug: job.tenant.slug,
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
            tenant: job.tenant.slug,
            url: trend.external_url,
            message,
          });
          summary.errors.push({
            tenant: job.tenant.slug,
            scope: `trend:${trend.hashtag ?? trend.external_url ?? "?"}`,
            message,
          });
        }
      }
    } catch (tenantErr) {
      summary.failed += 1;
      const message =
        tenantErr instanceof Error ? tenantErr.message : String(tenantErr);
      console.error("[cron/scrape-trends] tenant job failed", {
        tenant: job.tenant.slug,
        platform: job.platform,
        message,
      });
      summary.errors.push({
        tenant: job.tenant.slug,
        scope: `persist:${job.platform}`,
        message,
      });
    }
  }

  console.log("[cron/scrape-trends] complete", summary);
  return NextResponse.json(summary);
}
