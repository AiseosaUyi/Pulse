"use server";

import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import {
  critiqueAd,
  AdCritiqueError,
  type AdCritique,
  type AdPlatform,
  type AdObjective,
} from "@/lib/ai/critique-ad";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export interface CritiqueAdActionInput {
  platform: AdPlatform;
  objective: AdObjective;
  headline: string;
  primaryText: string;
  cta: string;
  audience?: string;
  visualDescription?: string;
  currentPerformance?: string;
}

export async function critiqueAdAction(
  tenantSlug: string,
  input: CritiqueAdActionInput
): Promise<ActionResult<{ critique: AdCritique }>> {
  if (!input.headline.trim() || !input.primaryText.trim() || !input.cta.trim()) {
    return { success: false, error: "Headline, primary text, and CTA are required" };
  }

  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const { voice, positioning } = await getBrandContext(tenantSlug);

  try {
    const result = await critiqueAd({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      ad: {
        platform: input.platform,
        objective: input.objective,
        headline: input.headline.trim(),
        primaryText: input.primaryText.trim(),
        cta: input.cta.trim(),
        audience: input.audience?.trim() || undefined,
        visual_description: input.visualDescription?.trim() || undefined,
        current_performance: input.currentPerformance?.trim() || undefined,
      },
    });
    return { success: true, critique: result.critique };
  } catch (err) {
    const msg =
      err instanceof AdCritiqueError
        ? "AI critique failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}
