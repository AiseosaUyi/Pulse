import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { groupPatterns, type PatternCluster } from "@/lib/ai/group-patterns";
import { generateBrief, BriefGenerationError } from "@/lib/ai/generate-brief";
import { weekOfIso } from "@/lib/util/week-of";
import type { IntelCard } from "@/lib/types/intelligence";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const summary = {
    tenantsProcessed: 0,
    generated: 0,
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

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekOf = weekOfIso(now);

  for (const tenant of tenants) {
    summary.tenantsProcessed += 1;
    try {
      const voice = await getBrandVoice(tenant.slug);
      if (!voice) {
        summary.skipped += 1;
        continue;
      }

      const { data: cardRows, error: cardsErr } = await admin
        .from("intel_cards")
        .select("*")
        .eq("tenant_id", tenant.slug)
        .gte("detected_at", sevenDaysAgo.toISOString());
      if (cardsErr) throw cardsErr;

      const cards: IntelCard[] = (cardRows ?? []).map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        competitorId: row.competitor_id,
        competitorName: row.competitor_name,
        competitorType: row.competitor_type,
        platform: row.platform,
        contentType: row.content_type,
        summary: row.summary,
        postUrl: row.post_url,
        metrics: row.metrics ?? {},
        aiRecommendation: row.ai_recommendation,
        detectedAt: row.detected_at,
        source: row.source,
      }));

      const clusters = groupPatterns(cards);
      if (clusters.length === 0) {
        continue;
      }

      for (const cluster of clusters) {
        try {
          const hash = patternHash(tenant.slug, cluster.key, weekOf);
          const { data: existing } = await admin
            .from("content_briefs")
            .select("id")
            .eq("tenant_id", tenant.slug)
            .eq("pattern_hash", hash)
            .maybeSingle();
          if (existing) {
            summary.skipped += 1;
            continue;
          }

          const brief = await generateBrief({
            tenantSlug: tenant.slug,
            tenantName: tenant.name,
            cluster,
            voice,
          });

          const { error: insertErr } = await admin
            .from("content_briefs")
            .insert({
              tenant_id: tenant.slug,
              triggered_by: cluster.cards[0]?.id ?? null,
              triggered_by_type: "intel_card",
              pattern_hash: hash,
              platform: cluster.cards[0]?.platform ?? "instagram",
              content_type: cluster.cards[0]?.contentType ?? "post",
              title: brief.title,
              outline: brief.outline,
              draft_content: brief.draftContent,
              seo_keywords: brief.seoKeywords ?? [],
              status: "draft",
              generator_model: "openai/gpt-5",
            });
          if (insertErr) throw insertErr;
          summary.generated += 1;
        } catch (clusterErr) {
          summary.failed += 1;
          const message =
            clusterErr instanceof BriefGenerationError
              ? clusterErr.message
              : clusterErr instanceof Error
              ? clusterErr.message
              : String(clusterErr);
          console.error(
            `[cron/generate-briefs] cluster failure`,
            { tenant: tenant.slug, cluster: cluster.key, message }
          );
          summary.errors.push({
            tenant: tenant.slug,
            scope: `cluster:${cluster.key}`,
            message,
          });
        }
      }
    } catch (tenantErr) {
      summary.failed += 1;
      const message =
        tenantErr instanceof Error ? tenantErr.message : String(tenantErr);
      console.error(`[cron/generate-briefs] tenant failure`, {
        tenant: tenant.slug,
        message,
      });
      summary.errors.push({ tenant: tenant.slug, scope: "tenant", message });
    }
  }

  console.log(`[cron/generate-briefs] complete`, summary);
  return NextResponse.json(summary);
}

function patternHash(slug: string, clusterKey: string, weekOf: string): string {
  return createHash("sha1").update(`${slug}|${clusterKey}|${weekOf}`).digest("hex");
}

// Export for reuse in tests.
export const _internal = { patternHash };
