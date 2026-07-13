import { describe, it, expect } from "vitest";
import { mintAccessToken, verifyAccessToken } from "@/lib/oauth/tokens";

describe("mintAccessToken / verifyAccessToken", () => {
  it("round-trips a minted token", async () => {
    const { token, expiresIn } = await mintAccessToken({
      userId: "11111111-1111-1111-1111-111111111111",
      tenantSlug: "test-tenant",
      scopes: ["sales:read", "content:write"],
      clientId: "mcp_client_test",
    });
    expect(expiresIn).toBeGreaterThan(0);

    const result = await verifyAccessToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe("11111111-1111-1111-1111-111111111111");
      expect(result.claims.tenant_slug).toBe("test-tenant");
      expect(result.claims.scopes).toBe("sales:read,content:write");
      expect(result.claims.client_id).toBe("mcp_client_test");
      expect(typeof result.claims.jti).toBe("string");
    }
  });

  it("rejects a garbage token as invalid", async () => {
    const result = await verifyAccessToken("not-a-real-jwt");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("rejects a token signed with a different secret", async () => {
    // A syntactically valid JWT (3 base64url segments) but not signed
    // with MCP_OAUTH_JWT_SECRET — must fail signature verification, not
    // silently decode.
    const forged =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdHRhY2tlciJ9.invalidsignature";
    const result = await verifyAccessToken(forged);
    expect(result.ok).toBe(false);
  });

  it("mints two tokens for the same claims with different jti (unique per token)", async () => {
    const claims = {
      userId: "22222222-2222-2222-2222-222222222222",
      tenantSlug: "test-tenant",
      scopes: ["admin"],
      clientId: "mcp_client_test",
    };
    const first = await mintAccessToken(claims);
    const second = await mintAccessToken(claims);
    const a = await verifyAccessToken(first.token);
    const b = await verifyAccessToken(second.token);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.claims.jti).not.toBe(b.claims.jti);
    }
  });
});
