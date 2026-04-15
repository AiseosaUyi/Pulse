import type { ContentBrief } from "@/lib/types/intelligence";
import { mockContentBriefs } from "@/lib/data/mock-intelligence";

export async function getContentBriefs(
  tenantSlug: string
): Promise<ContentBrief[]> {
  return mockContentBriefs[tenantSlug] ?? [];
}

export async function getContentBrief(
  tenantSlug: string,
  briefId: string
): Promise<ContentBrief | null> {
  const briefs = mockContentBriefs[tenantSlug] ?? [];
  return briefs.find((b) => b.id === briefId) ?? null;
}
