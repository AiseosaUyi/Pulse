import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as createSpace } from "@/app/api/v1/spaces/route";
import { POST as completeSpace } from "@/app/api/v1/spaces/[captureId]/complete/route";
import * as contextLib from "@/lib/api/context";
import * as r2Lib from "@/lib/storage/r2";
import { createAdminClient } from "@/lib/supabase/admin";

// Mock the context
vi.mock("@/lib/api/context", () => ({
  requireApiContext: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("@/lib/storage/r2", () => ({
  isR2Configured: vi.fn(),
  createR2PresignedPut: vi.fn(),
  r2ObjectExists: vi.fn(),
  r2PublicUrl: vi.fn((key: string) => `https://media.example.com/${key}`),
}));

describe("Spaces API", () => {
  const mockAdmin = {
    from: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default context mock to success
    vi.mocked(contextLib.requireApiContext).mockResolvedValue({
      ok: true,
      context: {
        tenantSlug: "test-tenant",
        tokenId: "test-token",
        scopes: ["content:write"],
        createdBy: "user-123",
        admin: mockAdmin as unknown as ReturnType<typeof createAdminClient>,
      },
    });

    vi.mocked(r2Lib.isR2Configured).mockReturnValue(true);
  });

  describe("POST /api/v1/spaces", () => {
    it("returns 400 if spaceUrl is missing", async () => {
      const req = new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ title: "No URL" }),
      });
      const res = await createSpace(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid body");
    });

    it("returns 400 if spaceUrl isn't an x.com/twitter.com Space URL", async () => {
      const req = new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ spaceUrl: "https://example.com/not-a-space" }),
      });
      const res = await createSpace(req);
      expect(res.status).toBe(400);
    });

    it("returns 500 if R2 isn't configured", async () => {
      vi.mocked(r2Lib.isR2Configured).mockReturnValue(false);
      const req = new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ spaceUrl: "https://x.com/i/spaces/123abc" }),
      });
      const res = await createSpace(req);
      expect(res.status).toBe(500);
    });

    it("inserts record and returns a presigned R2 upload URL", async () => {
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "cap-123" }, error: null }),
        }),
      });
      mockAdmin.from.mockReturnValue({ insert: insertMock });

      vi.mocked(r2Lib.createR2PresignedPut).mockResolvedValue("https://r2.example.com/upload");

      const req = new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({
          spaceUrl: "https://x.com/i/spaces/1abcXYZdefGHI",
          title: "My Space",
          hostHandle: "user1",
          durationS: 3600,
          transcript: "Hello world",
        }),
      });

      const res = await createSpace(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.captureId).toBe("cap-123");
      expect(json.uploadUrl).toBe("https://r2.example.com/upload");

      // Verify db insertion
      expect(insertMock).toHaveBeenCalledWith({
        tenant_slug: "test-tenant",
        title: "My Space",
        source_platform: "twitter",
        source_url: "https://x.com/i/spaces/1abcXYZdefGHI",
        author_handle: "user1",
        duration_sec: 3600,
        notes: "Hello world",
        extraction_status: "pending",
        saved_by: "user-123",
      });

      // Verify R2 key convention
      expect(r2Lib.createR2PresignedPut).toHaveBeenCalledWith(
        "assets/test-tenant/spaces/cap-123.mp3",
        "audio/mpeg"
      );
    });

    it("deletes the row and returns 500 if the presign call fails", async () => {
      const deleteEqMock = vi.fn().mockResolvedValue({ error: null });
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "cap-123" }, error: null }),
        }),
      });
      const deleteMock = vi.fn().mockReturnValue({ eq: deleteEqMock });
      mockAdmin.from.mockReturnValue({ insert: insertMock, delete: deleteMock });

      vi.mocked(r2Lib.createR2PresignedPut).mockRejectedValue(new Error("R2 down"));

      const req = new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ spaceUrl: "https://x.com/i/spaces/1abcXYZdefGHI" }),
      });

      const res = await createSpace(req);
      expect(res.status).toBe(500);
      expect(deleteMock).toHaveBeenCalled();
      expect(deleteEqMock).toHaveBeenCalledWith("id", "cap-123");
    });
  });

  describe("POST /api/v1/spaces/[captureId]/complete", () => {
    it("returns 404 if capture not found", async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
          }),
        }),
      });
      mockAdmin.from.mockReturnValue({ select: selectMock });

      const req = new Request("https://example.com", { method: "POST" });
      const res = await completeSpace(req, { params: Promise.resolve({ captureId: "invalid" }) });
      expect(res.status).toBe(404);
    });

    it("returns 409 if no object exists at the expected storage path", async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: "cap-123" }, error: null }),
          }),
        }),
      });
      mockAdmin.from.mockReturnValue({ select: selectMock });
      vi.mocked(r2Lib.r2ObjectExists).mockResolvedValue(false);

      const req = new Request("https://example.com", { method: "POST" });
      const res = await completeSpace(req, { params: Promise.resolve({ captureId: "cap-123" }) });
      expect(res.status).toBe(409);
    });

    it("marks extraction as extracted", async () => {
      // Mock find
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: "cap-123" }, error: null }),
          }),
        }),
      });

      // Mock update
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      mockAdmin.from.mockImplementation((table) => {
        if (table === "saved_content") {
          return { select: selectMock, update: updateMock };
        }
      });

      vi.mocked(r2Lib.r2ObjectExists).mockResolvedValue(true);

      const req = new Request("https://example.com", { method: "POST" });
      const res = await completeSpace(req, { params: Promise.resolve({ captureId: "cap-123" }) });
      expect(res.status).toBe(200);

      expect(r2Lib.r2ObjectExists).toHaveBeenCalledWith("assets/test-tenant/spaces/cap-123.mp3");
      expect(updateMock).toHaveBeenCalledWith({
        extraction_status: "extracted",
        stored_path: "assets/test-tenant/spaces/cap-123.mp3",
        stored_mime: "audio/mpeg",
      });
    });
  });
});
