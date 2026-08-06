import { describe, it, expect, vi } from "vitest";

const tenants: Record<string, Record<string, unknown>> = {
  gruve: {
    slug: "gruve",
    name: "Gruve",
    domain: "www.gruve.events",
    stagingDomain: "gamma.gruve.events",
    blogPathPrefix: "/blogs",
  },
  sippy: {
    slug: "sippy",
    name: "Sippy",
    domain: "www.sippy.life",
    stagingDomain: "test.sippy.life",
    blogPathPrefix: "/blog",
  },
  // Mirrors real prod state before staging was configured for a tenant —
  // must NOT leak another tenant's staging host or silently use no domain.
  "no-staging-configured": {
    slug: "no-staging-configured",
    name: "No Staging",
    domain: "example.com",
    stagingDomain: "",
    blogPathPrefix: "/blog",
  },
};

vi.mock("@/lib/services/tenants", () => ({
  getTenant: vi.fn().mockImplementation((slug: string) =>
    Promise.resolve(tenants[slug] ?? null)
  ),
}));

const { getTenantSeoConfig } = await import("@/lib/seo/tenant-seo-config");

describe("getTenantSeoConfig", () => {
  it("resolves Gruve's configured staging domain, not a hardcoded default", async () => {
    const config = await getTenantSeoConfig("gruve");
    expect(config.siteBaseUrl).toBe("https://www.gruve.events");
    expect(config.stagingBaseUrl).toBe("https://gamma.gruve.events");
    expect(config.blogPathPrefix).toBe("/blogs");
  });

  it("resolves Sippy's own staging domain — not Gruve's, and not its live domain", async () => {
    const config = await getTenantSeoConfig("sippy");
    expect(config.siteBaseUrl).toBe("https://www.sippy.life");
    expect(config.stagingBaseUrl).toBe("https://test.sippy.life");
    expect(config.stagingBaseUrl).not.toBe(config.siteBaseUrl);
    expect(config.blogPathPrefix).toBe("/blog");
  });

  it("falls back staging to the live domain (not another tenant's staging host) when unset", async () => {
    const config = await getTenantSeoConfig("no-staging-configured");
    expect(config.siteBaseUrl).toBe("https://example.com");
    expect(config.stagingBaseUrl).toBe("https://example.com");
  });

  it("returns null site/staging URLs for a tenant with no domain configured at all", async () => {
    const config = await getTenantSeoConfig("unknown-tenant");
    expect(config.siteBaseUrl).toBeNull();
    expect(config.stagingBaseUrl).toBeNull();
    expect(config.blogPathPrefix).toBe("/blog");
  });
});
