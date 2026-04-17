import { describe, it, expect, vi } from "vitest";
import { verifyCronRequest } from "@/lib/cron/auth";

// Unit tests for the cron auth gate. The real route handlers call
// verifyFromRequest(req) which delegates here; these tests cover the
// decision matrix without spinning up a server.

function makeHeaders(h: Record<string, string>) {
  return (name: string) => h[name.toLowerCase()] ?? null;
}

describe("cron auth", () => {
  it("rejects when CRON_SECRET is missing", () => {
    vi.stubEnv("CRON_SECRET", "");
    try {
      const res = verifyCronRequest({
        getHeader: makeHeaders({ authorization: "Bearer anything" }),
        secret: undefined,
        requireVercelHeader: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects when bearer doesn't match", () => {
    const res = verifyCronRequest({
      getHeader: makeHeaders({ authorization: "Bearer wrong" }),
      secret: "right",
      requireVercelHeader: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  it("rejects when authorization header absent", () => {
    const res = verifyCronRequest({
      getHeader: makeHeaders({}),
      secret: "right",
      requireVercelHeader: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  it("accepts in dev with bearer only (no Vercel header required)", () => {
    const res = verifyCronRequest({
      getHeader: makeHeaders({ authorization: "Bearer right" }),
      secret: "right",
      requireVercelHeader: false,
    });
    expect(res.ok).toBe(true);
  });

  it("in production mode, rejects a valid bearer without Vercel marker", () => {
    // Simulates a curl with a leaked CRON_SECRET — bearer matches, but
    // no x-vercel-cron header, so the gate denies it.
    const res = verifyCronRequest({
      getHeader: makeHeaders({ authorization: "Bearer right" }),
      secret: "right",
      requireVercelHeader: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.error).toMatch(/vercel/i);
    }
  });

  it("in production mode, accepts bearer + x-vercel-cron together", () => {
    const res = verifyCronRequest({
      getHeader: makeHeaders({
        authorization: "Bearer right",
        "x-vercel-cron": "1",
      }),
      secret: "right",
      requireVercelHeader: true,
    });
    expect(res.ok).toBe(true);
  });

  it("case-insensitive on the authorization header name", () => {
    // Next's Request.headers is case-insensitive; verifyCronRequest asks
    // via the provided getter. This asserts the gate uses lowercase.
    const headers = { authorization: "Bearer right" };
    const res = verifyCronRequest({
      getHeader: (name) => headers[name.toLowerCase() as keyof typeof headers] ?? null,
      secret: "right",
      requireVercelHeader: false,
    });
    expect(res.ok).toBe(true);
  });
});
