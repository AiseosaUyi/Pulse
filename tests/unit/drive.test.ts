// Drive integration unit tests. Stubs global fetch — no real Drive
// calls. E2E tests in tests/e2e/content-pipeline/ exercise the full
// resumable flow against a Playwright global-setup stub server.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DriveError,
  buildAuthUrl,
  createResumableSession,
  exchangeCodeForTokens,
  isDriveConfigured,
  refreshAccessToken,
} from "@/lib/integrations/drive";

const ENV = {
  GOOGLE_DRIVE_CLIENT_ID: "test-client-id",
  GOOGLE_DRIVE_CLIENT_SECRET: "test-client-secret",
  GOOGLE_DRIVE_REDIRECT_URI: "https://app.test/api/integrations/drive/callback",
};

describe("drive", () => {
  beforeEach(() => {
    Object.entries(ENV).forEach(([k, v]) => {
      process.env[k] = v;
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.keys(ENV).forEach((k) => {
      delete process.env[k];
    });
  });

  describe("isDriveConfigured", () => {
    it("returns true when all env vars set", () => {
      expect(isDriveConfigured()).toBe(true);
    });

    it("returns false when any env var missing", () => {
      delete process.env.GOOGLE_DRIVE_CLIENT_ID;
      expect(isDriveConfigured()).toBe(false);
    });
  });

  describe("buildAuthUrl", () => {
    it("includes scope, state, offline access, force consent", () => {
      const url = buildAuthUrl("nonce-123");
      expect(url).toContain("client_id=test-client-id");
      expect(url).toContain("response_type=code");
      expect(url).toContain("access_type=offline");
      expect(url).toContain("prompt=consent");
      expect(url).toContain("state=nonce-123");
      expect(url).toContain(
        encodeURIComponent("https://www.googleapis.com/auth/drive.file")
      );
    });

    it("throws config_missing when env vars absent", () => {
      delete process.env.GOOGLE_DRIVE_CLIENT_ID;
      expect(() => buildAuthUrl("x")).toThrow(DriveError);
      try {
        buildAuthUrl("x");
      } catch (err) {
        expect((err as DriveError).reason).toBe("config_missing");
      }
    });
  });

  describe("exchangeCodeForTokens", () => {
    it("returns tokens on 200", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
            scope: "...",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      const out = await exchangeCodeForTokens("auth-code");
      expect(out.access_token).toBe("at");
      expect(out.refresh_token).toBe("rt");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("throws auth_revoked on 400", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("invalid_grant", { status: 400 })
      );
      try {
        await exchangeCodeForTokens("bad-code");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(DriveError);
        expect((err as DriveError).reason).toBe("auth_revoked");
      }
    });

    it("throws fetch_failed on 5xx", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("upstream", { status: 503 })
      );
      try {
        await exchangeCodeForTokens("code");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as DriveError).reason).toBe("fetch_failed");
      }
    });
  });

  describe("refreshAccessToken", () => {
    it("returns access token + expiry", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-at",
            expires_in: 3600,
            scope: "...",
            token_type: "Bearer",
          }),
          { status: 200 }
        )
      );
      const out = await refreshAccessToken("rt");
      expect(out.accessToken).toBe("new-at");
      expect(out.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("throws auth_revoked on 400 (refresh token invalid)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("invalid_grant", { status: 400 })
      );
      try {
        await refreshAccessToken("revoked-rt");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as DriveError).reason).toBe("auth_revoked");
      }
    });
  });

  describe("createResumableSession", () => {
    it("returns session URI from Location header", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            location: "https://www.googleapis.com/upload/...session-uri",
          },
        })
      );
      const out = await createResumableSession("at", {
        filename: "video.mp4",
        mimeType: "video/mp4",
        sizeBytes: 100_000_000,
        parentId: "folder-id",
      });
      expect(out.uri).toContain("session-uri");
    });

    it("throws auth_revoked on 401", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 401 })
      );
      try {
        await createResumableSession("bad-token", {
          filename: "x",
          mimeType: "image/png",
          sizeBytes: 1,
          parentId: "p",
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as DriveError).reason).toBe("auth_revoked");
      }
    });

    it("throws quota_exceeded on 403 with quota body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("storageQuotaExceeded: out of room", { status: 403 })
      );
      try {
        await createResumableSession("at", {
          filename: "x",
          mimeType: "image/png",
          sizeBytes: 1,
          parentId: "p",
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as DriveError).reason).toBe("quota_exceeded");
      }
    });

    it("throws permission_denied on plain 403", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("forbidden", { status: 403 })
      );
      try {
        await createResumableSession("at", {
          filename: "x",
          mimeType: "image/png",
          sizeBytes: 1,
          parentId: "p",
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as DriveError).reason).toBe("permission_denied");
      }
    });

    it("throws rate_limited on 429", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 429 })
      );
      try {
        await createResumableSession("at", {
          filename: "x",
          mimeType: "image/png",
          sizeBytes: 1,
          parentId: "p",
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as DriveError).reason).toBe("rate_limited");
      }
    });

    it("throws fetch_failed when 200 has no Location header", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 200 })
      );
      try {
        await createResumableSession("at", {
          filename: "x",
          mimeType: "image/png",
          sizeBytes: 1,
          parentId: "p",
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as DriveError).reason).toBe("fetch_failed");
      }
    });
  });
});
