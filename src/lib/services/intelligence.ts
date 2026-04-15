import type { Competitor, IntelCard, MorningBriefItem, WeeklyDigest } from "@/lib/types/intelligence";
import { mockCompetitorsIntel, mockIntelCards, mockMorningBrief, mockWeeklyDigest } from "@/lib/data/mock-intelligence";

export async function getCompetitors(
  tenantSlug: string
): Promise<Competitor[]> {
  return mockCompetitorsIntel[tenantSlug] ?? [];
}

export async function getIntelFeed(
  tenantSlug: string
): Promise<IntelCard[]> {
  const cards = mockIntelCards[tenantSlug] ?? [];
  return cards.sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
  );
}

export async function getMorningBrief(
  tenantSlug: string
): Promise<MorningBriefItem[]> {
  return mockMorningBrief[tenantSlug] ?? [];
}

export async function getWeeklyDigest(
  tenantSlug: string
): Promise<WeeklyDigest | null> {
  return mockWeeklyDigest[tenantSlug] ?? null;
}
