import { describe, it, expect } from "vitest";
import { hasScope } from "@/lib/api/scopes";

// Unit tests for the scope-match logic behind requireApiContext. Pure
// function, no DB — the DB-touching parts (token lookup, rate limit)
// are covered by the integration tests instead.

describe("hasScope", () => {
  it("passes when no scope is required", () => {
    expect(hasScope([], null)).toBe(true);
    expect(hasScope(["sales:read"], null)).toBe(true);
  });

  it("rejects an empty scope list against a required scope", () => {
    expect(hasScope([], "sales:read")).toBe(false);
  });

  it("matches an exact scope", () => {
    expect(hasScope(["sales:read", "content:read"], "sales:read")).toBe(true);
  });

  it("rejects when the scope isn't granted", () => {
    expect(hasScope(["sales:read"], "sales:write")).toBe(false);
  });

  it("admin implies every scope", () => {
    expect(hasScope(["admin"], "sales:write")).toBe(true);
    expect(hasScope(["admin"], "analytics:read")).toBe(true);
  });
});
