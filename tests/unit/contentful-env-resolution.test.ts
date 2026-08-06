import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/services/integrations", () => ({
  getIntegrationSecrets: vi.fn().mockImplementation((tenantSlug: string) => {
    if (tenantSlug === "custom-tenant") {
      return Promise.resolve({
        secretToken: "CFPAT-test",
        config: {
          space_id: "jy8xa6d4nxhk",
          environment: "master",
          // test_environment NOT provided -> should fallback to master (not hardcoded Production)
        },
      });
    }
    if (tenantSlug === "staging-tenant") {
      return Promise.resolve({
        secretToken: "CFPAT-test",
        config: {
          space_id: "space-staging",
          environment: "master",
          test_environment: "staging-env",
        },
      });
    }
    return Promise.resolve(null);
  }),
}));

const { resolveContentfulConfig } = await import(
  "@/lib/integrations/contentful"
);

describe("resolveContentfulConfig environment resolution", () => {
  it("defaults test target to live environment (master) when test_environment is unset", async () => {
    const config = await resolveContentfulConfig("custom-tenant", "test");
    expect(config).not.toBeNull();
    expect(config?.spaceId).toBe("jy8xa6d4nxhk");
    expect(config?.envId).toBe("master"); // Safely uses master instead of invalid Production
  });

  it("uses explicit test_environment when configured by tenant", async () => {
    const config = await resolveContentfulConfig("staging-tenant", "test");
    expect(config).not.toBeNull();
    expect(config?.spaceId).toBe("space-staging");
    expect(config?.envId).toBe("staging-env");
  });
});
