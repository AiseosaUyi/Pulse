import { DashboardStats, Suggestion } from "@/lib/types/dashboard";
import { PlatformConnection } from "@/lib/types/tenant";
import { mockDashboardStats, mockSuggestions } from "@/lib/data/mock-dashboard";
import { mockTenants } from "@/lib/data/mock-tenants";

export async function getDashboardStats(
  tenantSlug: string
): Promise<DashboardStats | null> {
  return mockDashboardStats[tenantSlug] ?? null;
}

export async function getPlatforms(
  tenantSlug: string
): Promise<PlatformConnection[]> {
  const tenant = mockTenants.find((t) => t.slug === tenantSlug);
  return tenant?.platforms ?? [];
}

export async function getSuggestions(
  tenantSlug: string
): Promise<Suggestion[]> {
  return mockSuggestions[tenantSlug] ?? [];
}
