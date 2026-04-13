import { Tenant } from "@/lib/types/tenant";
import { mockTenants } from "@/lib/data/mock-tenants";

export async function getTenants(): Promise<Tenant[]> {
  return mockTenants;
}

export async function getTenant(slug: string): Promise<Tenant | null> {
  return mockTenants.find((t) => t.slug === slug) ?? null;
}
