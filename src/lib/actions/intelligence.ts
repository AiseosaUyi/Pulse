"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function submitCompetitorPost(formData: FormData) {
  const competitorId = formData.get("competitorId") as string;
  const competitorName = formData.get("competitorName") as string;
  const competitorType = formData.get("competitorType") as string;
  const tenantId = formData.get("tenantId") as string;
  const platform = formData.get("platform") as string;
  const contentType = formData.get("contentType") as string;
  const postUrl = formData.get("postUrl") as string;
  const summary = formData.get("summary") as string;
  const views = formData.get("views") as string;
  const likes = formData.get("likes") as string;
  const comments = formData.get("comments") as string;
  const shares = formData.get("shares") as string;

  if (!summary?.trim()) {
    return { success: false, error: "Summary is required" };
  }

  const hasMetric = [views, likes, comments, shares].some(
    (v) => v && Number(v) > 0
  );
  if (!hasMetric) {
    return { success: false, error: "At least one engagement metric is required" };
  }

  const metrics = {
    views: views ? Number(views) : undefined,
    likes: likes ? Number(likes) : undefined,
    comments: comments ? Number(comments) : undefined,
    shares: shares ? Number(shares) : undefined,
    engagement: Number(likes || 0) + Number(comments || 0) + Number(shares || 0),
    engagementRate: 0,
    vsAverage: null,
  };

  if (metrics.views && metrics.views > 0) {
    metrics.engagementRate = Number(((metrics.engagement / metrics.views) * 100).toFixed(1));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intel_cards")
    .insert({
      tenant_id: tenantId,
      competitor_id: competitorId,
      competitor_name: competitorName,
      competitor_type: competitorType,
      platform,
      content_type: contentType,
      summary: summary.trim(),
      post_url: postUrl || null,
      metrics,
      ai_recommendation: {
        impact: "medium",
        urgency: "fyi",
        analysis: "AI analysis pending. Manual review recommended.",
        action: "Review this competitor activity and decide on a response.",
        contentBriefReady: false,
      },
      source: "manual",
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/intel-feed");
  return { success: true, cardId: data.id };
}

// generateContentBrief moved to src/lib/actions/briefs.ts as
// generateBriefFromCard — now uses real AI via Vercel AI Gateway.
