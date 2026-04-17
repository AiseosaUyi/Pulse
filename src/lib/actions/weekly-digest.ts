"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { getTenant } from "@/lib/services/tenants";
import {
  aggregateCompetitorMoves,
  aggregateWinningFormats,
  aggregateOwnPerformance,
  aggregateSeoSummary,
  aggregateLeadsSummary,
  weekOfSaturday,
} from "@/lib/services/insights";
import { synthesizeDigest } from "@/lib/ai/synthesize-digest";
import { startOfWeekSaturday } from "@/lib/util/week-of";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function generateWeeklyDigest(
  tenantSlug: string,
  options: { force?: boolean } = {}
): Promise<ActionResult<{ digestId: string }>> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const now = new Date();
  const weekStart = startOfWeekSaturday(now);
  const weekOf = weekOfSaturday(now);

  const admin = createAdminClient();

  // Idempotency: skip if digest already exists for this week unless forced.
  if (!options.force) {
    const { data: existing } = await admin
      .from("weekly_digests")
      .select("id")
      .eq("tenant_slug", tenantSlug)
      .eq("week_of", weekOf)
      .maybeSingle();
    if (existing) {
      return { success: true, digestId: (existing as { id: string }).id };
    }
  }

  try {
    const [moves, formats, own, seo, leads, voice] = await Promise.all([
      aggregateCompetitorMoves(tenantSlug, weekStart),
      aggregateWinningFormats(tenantSlug, weekStart),
      aggregateOwnPerformance(tenantSlug, weekStart),
      aggregateSeoSummary(tenantSlug),
      aggregateLeadsSummary(tenantSlug, weekStart),
      getBrandVoice(tenantSlug),
    ]);

    const { synthesis, costUsd } = await synthesizeDigest({
      voice,
      data: {
        tenantSlug,
        tenantName: tenant.name,
        weekOf,
        topCompetitorMoves: moves,
        winningFormats: formats,
        ownPerformance: own,
        seoSummary: seo,
        leadsSummary: leads,
      },
    });

    const { data, error } = await admin
      .from("weekly_digests")
      .upsert(
        {
          tenant_slug: tenantSlug,
          week_of: weekOf,
          strategic_brief: synthesis.strategic_brief,
          top_competitor_moves: moves,
          winning_formats: formats,
          recommended_actions: synthesis.recommended_actions,
          own_performance: own,
          seo_summary: seo,
          leads_summary: leads,
          generator_model: "openai/gpt-4.1",
          generator_cost_usd: costUsd,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_slug,week_of" }
      )
      .select("id")
      .single();

    if (error || !data) {
      return { success: false, error: error?.message ?? "Insert failed" };
    }

    revalidatePath("/weekly-report");
    revalidatePath("/dashboard");
    return { success: true, digestId: data.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Digest generation failed",
    };
  }
}
