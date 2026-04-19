// Onboarding progress service — counts the "did the user fill this in"
// state for each checklist step. Called from the sidebar widget and
// server actions that need to know whether a tenant has graduated past
// onboarding.
//
// Steps are defined here, not in a JSON file, because their gating
// logic lives in code (Supabase queries + settings checks).

import { createAdminClient } from "@/lib/supabase/admin";
import { isBrandVoiceComplete } from "@/lib/ai/brand-voice";
import { isBrandPositioningComplete } from "@/lib/ai/brand-positioning";

export type OnboardingStepId =
  | "brand-audit"
  | "competitors"
  | "keywords"
  | "first-blog";

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  description: string;
  done: boolean;
  /** Optional progress string for partial states ("2 of 3"). */
  progress?: string;
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  allDone: boolean;
}

const COMPETITOR_TARGET = 3;
const KEYWORD_TARGET = 5;

/**
 * Read-only snapshot of where a tenant is in onboarding. Uses the
 * admin client because the sidebar widget loads on every app page —
 * RLS already gates the underlying data elsewhere; here we just want
 * counts.
 */
export async function getOnboardingProgress(
  tenantSlug: string
): Promise<OnboardingProgress> {
  const admin = createAdminClient();

  const [settingsRes, competitorRes, keywordRes, blogRes] = await Promise.all([
    admin.from("tenants").select("settings").eq("slug", tenantSlug).maybeSingle(),
    admin
      .from("competitors")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantSlug),
    admin
      .from("keyword_rankings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantSlug),
    admin
      .from("blog_posts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", tenantSlug),
  ]);

  const settings =
    (settingsRes.data?.settings as Record<string, unknown> | null) ?? null;
  const voiceDone =
    isBrandVoiceComplete(settings?.brand_voice) &&
    isBrandPositioningComplete(settings?.brand_positioning);

  const competitorCount = competitorRes.count ?? 0;
  const keywordCount = keywordRes.count ?? 0;
  const blogCount = blogRes.count ?? 0;

  const steps: OnboardingStep[] = [
    {
      id: "brand-audit",
      label: "Run your brand audit",
      description:
        "Paste your URL, we extract your voice and positioning in ~20 seconds.",
      done: voiceDone,
    },
    {
      id: "competitors",
      label: `Add ${COMPETITOR_TARGET} competitors`,
      description:
        "Give your team a benchmark. Paste their names or domains — we'll do the rest.",
      done: competitorCount >= COMPETITOR_TARGET,
      progress:
        competitorCount < COMPETITOR_TARGET
          ? `${competitorCount} of ${COMPETITOR_TARGET}`
          : undefined,
    },
    {
      id: "keywords",
      label: `Track ${KEYWORD_TARGET} keywords`,
      description:
        "The SEO queries you care about most. We rank and score content against them.",
      done: keywordCount >= KEYWORD_TARGET,
      progress:
        keywordCount < KEYWORD_TARGET
          ? `${keywordCount} of ${KEYWORD_TARGET}`
          : undefined,
    },
    {
      id: "first-blog",
      label: "Generate your first blog",
      description:
        "Watch the iterate-to-90 loop in action. ~2 minutes, fully on-brand.",
      done: blogCount > 0,
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return {
    steps,
    completed,
    total: steps.length,
    allDone: completed === steps.length,
  };
}
