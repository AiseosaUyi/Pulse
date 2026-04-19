"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { totalsForWindow } from "@/lib/services/analytics";
import {
  synthesizeWeeklyReview,
  WeeklyReviewError,
  type WeeklyReview,
} from "@/lib/ai/weekly-review";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

/**
 * Saturday-anchored week-of date (matches existing weekly_digests
 * convention from migration 016).
 */
function weekOfSaturday(d = new Date()): string {
  const day = d.getUTCDay(); // 0=Sun
  const back = (day + 1) % 7; // Saturday = 6 → back 0; Sunday = 0 → back 1
  const sat = new Date(d);
  sat.setUTCDate(d.getUTCDate() - back);
  return sat.toISOString().slice(0, 10);
}

function sevenDaysAgoIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString();
}

async function collectPayload(tenantSlug: string) {
  const admin = createAdminClient();
  const since = sevenDaysAgoIso();

  const [
    blogsRes,
    distRes,
    topBlogRes,
    blogPubsRes,
    spPubsRes,
    prospectsAllRes,
    prospectsRecentRes,
    dmsRes,
    coachRes,
    adCritRes,
    aiCostRes,
  ] = await Promise.all([
    admin
      .from("blog_posts")
      .select("id, title, content_score, status, updated_at")
      .eq("tenant_slug", tenantSlug)
      .gte("updated_at", since),
    admin
      .from("content_distributions")
      .select("id, status")
      .eq("tenant_slug", tenantSlug)
      .gte("updated_at", since),
    admin
      .from("blog_posts")
      .select("title, content_score")
      .eq("tenant_slug", tenantSlug)
      .eq("status", "published")
      .order("content_score", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("blog_publications")
      .select("provider, status")
      .eq("tenant_slug", tenantSlug)
      .gte("published_at", since),
    admin
      .from("scheduled_post_publications")
      .select("status")
      .eq("tenant_slug", tenantSlug)
      .gte("published_at", since),
    admin
      .from("prospects")
      .select("id, status")
      .eq("tenant_slug", tenantSlug),
    admin
      .from("prospects")
      .select("id")
      .eq("tenant_slug", tenantSlug)
      .gte("created_at", since),
    admin
      .from("outbound_dms")
      .select("status, updated_at, sent_at")
      .eq("tenant_slug", tenantSlug)
      .gte("updated_at", since),
    admin
      .from("coach_actions")
      .select("status, updated_at, created_at")
      .eq("tenant_slug", tenantSlug)
      .gte("updated_at", since),
    admin
      .from("ai_call_log")
      .select("id")
      .eq("tenant_slug", tenantSlug)
      .eq("feature", "ad_critique")
      .gte("created_at", since),
    admin
      .from("ai_call_log")
      .select("cost_usd")
      .eq("tenant_slug", tenantSlug)
      .gte("created_at", since),
  ]);

  const blogs = blogsRes.data ?? [];
  const distributions = distRes.data ?? [];
  const blogPubs = blogPubsRes.data ?? [];
  const spPubs = spPubsRes.data ?? [];
  const prospectsAll = prospectsAllRes.data ?? [];
  const prospectsRecent = prospectsRecentRes.data ?? [];
  const dms = dmsRes.data ?? [];
  const coach = coachRes.data ?? [];
  const adCrit = adCritRes.data ?? [];
  const aiCost = aiCostRes.data ?? [];

  const analyticsTotals = await totalsForWindow(tenantSlug, 7);
  const analyticsAvailable =
    analyticsTotals.pageviews > 0 ||
    analyticsTotals.sessions > 0 ||
    analyticsTotals.users > 0;

  return {
    content: {
      blogs_published: blogs.filter((b) => b.status === "published").length,
      blogs_drafted: blogs.filter((b) => b.status !== "published").length,
      distributions_approved: distributions.filter(
        (d) => d.status === "approved" || d.status === "scheduled"
      ).length,
      top_blog_title: topBlogRes.data?.title,
      top_blog_score: topBlogRes.data?.content_score ?? undefined,
    },
    publish: {
      wordpress_posts: blogPubs.filter((p) => p.provider === "wordpress").length,
      ghost_posts: blogPubs.filter((p) => p.provider === "ghost").length,
      ayrshare_sends: spPubs.filter((p) => p.status === "published").length,
      failed:
        blogPubs.filter((p) => p.status === "failed").length +
        spPubs.filter((p) => p.status === "failed").length,
    },
    outbound: {
      prospects_added: prospectsRecent.length,
      qualified: prospectsAll.filter(
        (p) => p.status === "qualified" || p.status === "drafted"
      ).length,
      sent: dms.filter((d) => d.status === "sent" || d.sent_at != null).length,
      replied: dms.filter((d) => d.status === "replied").length,
      handed_off: prospectsAll.filter((p) => p.status === "handed_off").length,
    },
    coach: {
      generated: coach.length,
      completed: coach.filter((a) => a.status === "done").length,
      pending: coach.filter(
        (a) => a.status === "pending" || a.status === "in_progress"
      ).length,
    },
    ads: {
      critiques_run: adCrit.length,
    },
    analytics: {
      pageviews: analyticsTotals.pageviews,
      sessions: analyticsTotals.sessions,
      users: analyticsTotals.users,
      conversions: analyticsTotals.conversions,
      top_pages: analyticsTotals.topPages.map((p) => ({
        path: p.path,
        pageviews: p.pageviews,
      })),
      available: analyticsAvailable,
    },
    spend: {
      ai_cost_usd: aiCost.reduce(
        (sum, r) => sum + Number(r.cost_usd ?? 0),
        0
      ),
    },
  };
}

export async function generateWeeklyReview(
  tenantSlug: string
): Promise<ActionResult<{ review: WeeklyReview; weekOf: string }>> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const weekOf = weekOfSaturday();
  const payload = await collectPayload(tenantSlug);
  const { voice, positioning } = await getBrandContext(tenantSlug);

  try {
    const { review, model, costUsd } = await synthesizeWeeklyReview({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      weekOf,
      payload,
    });

    const admin = createAdminClient();
    await admin.from("weekly_digests").upsert(
      {
        tenant_slug: tenantSlug,
        week_of: weekOf,
        narrative: review.narrative,
        business_review: {
          review,
          payload,
        },
        generator_model: model,
        generator_cost_usd: costUsd,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_slug,week_of" }
    );

    revalidatePath("/dashboard");
    revalidatePath("/weekly-report");
    return { success: true, review, weekOf };
  } catch (err) {
    const msg =
      err instanceof WeeklyReviewError
        ? "Review generation failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}
