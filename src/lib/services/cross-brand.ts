import type { IntelCard } from "@/lib/types/intelligence";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CrossBrandPattern {
  id: string;
  pattern: string;
  evidence: string;
  tenants: string[];
  format: string;
  avgMultiplier: number;
  recommendation: string;
  detectedAt: string;
}

export interface AnomalyAlert {
  id: string;
  tenantId: string;
  intelCardId: string;
  competitorName: string;
  platform: string;
  type: "engagement_spike" | "new_platform" | "viral_post";
  message: string;
  multiplier: number;
  dismissed: boolean;
  detectedAt: string;
}

// Cross-brand pattern detection — uses service-role client to bypass RLS
export async function detectCrossBrandPatterns(): Promise<CrossBrandPattern[]> {
  const supabaseAdmin = createAdminClient();
  // Get all intel cards across ALL tenants (service-role bypasses RLS)
  const { data: allCards, error } = await supabaseAdmin
    .from("intel_cards")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(100);

  if (error || !allCards || allCards.length < 2) return [];

  // Group cards by content_type across tenants
  const formatGroups: Record<string, { cards: typeof allCards; tenants: Set<string> }> = {};

  for (const card of allCards) {
    const key = `${card.content_type}-${card.platform}`;
    if (!formatGroups[key]) {
      formatGroups[key] = { cards: [], tenants: new Set() };
    }
    formatGroups[key].cards.push(card);
    formatGroups[key].tenants.add(card.tenant_id);
  }

  const patterns: CrossBrandPattern[] = [];

  for (const [key, group] of Object.entries(formatGroups)) {
    // Only flag patterns that appear across 2+ tenants
    if (group.tenants.size < 2) continue;

    const [contentType, platform] = key.split("-");
    const cardsWithAvg = group.cards.filter(
      (c) => c.metrics?.vsAverage && c.metrics.vsAverage > 1.5
    );

    if (cardsWithAvg.length === 0) continue;

    const avgMultiplier =
      cardsWithAvg.reduce((sum, c) => sum + (c.metrics?.vsAverage ?? 0), 0) /
      cardsWithAvg.length;

    const tenantList = Array.from(group.tenants);
    const evidence = cardsWithAvg
      .map((c) => `${c.competitor_name} (${c.tenant_id}): ${c.metrics?.vsAverage}x avg`)
      .join("; ");

    patterns.push({
      id: `pattern-${key}`,
      pattern: `${contentType} on ${platform} outperforms across brands`,
      evidence,
      tenants: tenantList,
      format: contentType,
      avgMultiplier: Number(avgMultiplier.toFixed(1)),
      recommendation: `${contentType} content on ${platform} is working for competitors across both ${tenantList.join(" and ")}. This isn't brand-specific — it's an audience-level trend. Both brands should prioritize this format.`,
      detectedAt: new Date().toISOString(),
    });
  }

  // Sort by multiplier (strongest patterns first)
  return patterns.sort((a, b) => b.avgMultiplier - a.avgMultiplier);
}

// Anomaly detection — find intel cards with engagement 3x+ above competitor average
export async function detectAnomalies(tenantSlug: string): Promise<AnomalyAlert[]> {
  const supabaseAdmin = createAdminClient();
  const { data: cards, error } = await supabaseAdmin
    .from("intel_cards")
    .select("*")
    .eq("tenant_id", tenantSlug)
    .order("detected_at", { ascending: false })
    .limit(50);

  if (error || !cards) return [];

  const alerts: AnomalyAlert[] = [];

  for (const card of cards) {
    const vsAvg = card.metrics?.vsAverage;
    if (vsAvg && vsAvg >= 3) {
      alerts.push({
        id: `alert-${card.id}`,
        tenantId: card.tenant_id,
        intelCardId: card.id,
        competitorName: card.competitor_name,
        platform: card.platform,
        type: "engagement_spike",
        message: `${card.competitor_name} posted a ${card.content_type} on ${card.platform} that got ${vsAvg}x their average engagement. This is unusual — worth investigating.`,
        multiplier: vsAvg,
        dismissed: false,
        detectedAt: card.detected_at,
      });
    }

    // Viral post detection (100K+ views)
    if (card.metrics?.views && card.metrics.views >= 100000) {
      // Don't duplicate if already flagged as engagement spike
      if (!alerts.find((a) => a.intelCardId === card.id)) {
        alerts.push({
          id: `alert-viral-${card.id}`,
          tenantId: card.tenant_id,
          intelCardId: card.id,
          competitorName: card.competitor_name,
          platform: card.platform,
          type: "viral_post",
          message: `${card.competitor_name}'s ${card.content_type} on ${card.platform} hit ${(card.metrics.views / 1000).toFixed(0)}K views. Viral content in your space — study what they did differently.`,
          multiplier: vsAvg ?? 0,
          dismissed: false,
          detectedAt: card.detected_at,
        });
      }
    }
  }

  return alerts.sort((a, b) => b.multiplier - a.multiplier);
}
