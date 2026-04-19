import { createClient } from "@/lib/supabase/server";
import type { WeeklyReview } from "@/lib/ai/weekly-review";

export interface WeeklyReviewRecord {
  id: string;
  tenantSlug: string;
  weekOf: string;
  narrative: string | null;
  review: WeeklyReview | null;
  generatedAt: string;
  emailSentAt: string | null;
}

/**
 * Pull the most recent weekly review. Null when the tenant has never
 * run one — the dashboard then offers a "Generate this week's review"
 * CTA.
 */
export async function getLatestWeeklyReview(
  tenantSlug: string
): Promise<WeeklyReviewRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weekly_digests")
    .select(
      "id, tenant_slug, week_of, narrative, business_review, generated_at, email_sent_at"
    )
    .eq("tenant_slug", tenantSlug)
    .not("narrative", "is", null)
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const reviewPayload = (data.business_review as { review?: WeeklyReview }) ?? {};
  return {
    id: data.id,
    tenantSlug: data.tenant_slug,
    weekOf: data.week_of,
    narrative: data.narrative,
    review: reviewPayload.review ?? null,
    generatedAt: data.generated_at,
    emailSentAt: data.email_sent_at,
  };
}
