import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { admin } from "../helpers/clients";
import { generateToken, hashToken } from "../../src/lib/api-tokens";
import { deleteFromR2, r2ObjectExists, isR2Configured } from "../../src/lib/storage/r2";
import { publicUrlFor } from "../../src/lib/storage/save-asset";

// Real-DB + real-R2 integration test for the X/Twitter Space capture flow
// — the server-side counterpart of scripts/space-capture/download_space.sh.
// Unlike tests/api/spaces.test.ts (which mocks R2 entirely), this actually
// PUTs bytes to the presigned URL and reads them back, proving the whole
// pipeline works end to end: create -> real R2 upload -> complete ->
// saved_content row -> publicly fetchable audio.

const TENANT = `api-v1-spaces-${Math.random().toString(36).slice(2, 8)}`;
const GHOST = `api-v1-spaces-ghost-${Math.random().toString(36).slice(2, 8)}`;

let writeToken: string;
let readOnlyToken: string;
let ghostWriteToken: string;
const cleanupKeys: string[] = [];

async function mintToken(tenantSlug: string, scope: string): Promise<string> {
  const raw = generateToken();
  const { error } = await admin.from("tenant_api_tokens").insert({
    tenant_slug: tenantSlug,
    name: `test-${scope}`,
    token_hash: hashToken(raw),
    token_prefix: raw.slice(0, 14),
    token_last4: raw.slice(-4),
    scope,
  });
  if (error) throw error;
  return raw;
}

beforeAll(async () => {
  const { error: tErr } = await admin
    .from("tenants")
    .insert([
      { slug: TENANT, name: "API v1 Spaces Test" },
      { slug: GHOST, name: "API v1 Spaces Ghost" },
    ]);
  if (tErr) throw tErr;

  writeToken = await mintToken(TENANT, "content:write");
  readOnlyToken = await mintToken(TENANT, "content:read");
  ghostWriteToken = await mintToken(GHOST, "content:write");
});

afterAll(async () => {
  await Promise.all(cleanupKeys.map((key) => deleteFromR2(key).catch(() => {})));
  await admin.from("tenants").delete().in("slug", [TENANT, GHOST]);
});

function authedRequest(url: string, token: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}` },
  });
}

const r2Ready = isR2Configured();

describe("/api/v1/spaces", () => {
  it("rejects a non-Space URL with 400", async () => {
    const { POST } = await import("../../src/app/api/v1/spaces/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/spaces", writeToken, {
        method: "POST",
        body: JSON.stringify({ spaceUrl: "https://example.com/not-a-space" }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid body");
  });

  it("rejects a read-only token with 403", async () => {
    const { POST } = await import("../../src/app/api/v1/spaces/route");
    const res = await POST(
      authedRequest("https://test.local/api/v1/spaces", readOnlyToken, {
        method: "POST",
        body: JSON.stringify({ spaceUrl: "https://x.com/i/spaces/1abcXYZdefGHI" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("OPTIONS /spaces returns a CORS preflight response", async () => {
    const { OPTIONS } = await import("../../src/app/api/v1/spaces/route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it.skipIf(!r2Ready)("complete 409s when nothing was ever uploaded", async () => {
    const { POST: createSpace } = await import("../../src/app/api/v1/spaces/route");
    const createRes = await createSpace(
      authedRequest("https://test.local/api/v1/spaces", writeToken, {
        method: "POST",
        body: JSON.stringify({ spaceUrl: "https://x.com/i/spaces/1neverUploaded" }),
      })
    );
    expect(createRes.status).toBe(200);
    const { captureId } = await createRes.json();

    const { POST: completeSpace } = await import(
      "../../src/app/api/v1/spaces/[captureId]/complete/route"
    );
    const completeRes = await completeSpace(
      authedRequest(`https://test.local/api/v1/spaces/${captureId}/complete`, writeToken, {
        method: "POST",
      }),
      { params: Promise.resolve({ captureId }) }
    );
    expect(completeRes.status).toBe(409);
  });

  it.skipIf(!r2Ready)("404s completing a capture that belongs to a different tenant", async () => {
    const { POST: createSpace } = await import("../../src/app/api/v1/spaces/route");
    const createRes = await createSpace(
      authedRequest("https://test.local/api/v1/spaces", writeToken, {
        method: "POST",
        body: JSON.stringify({ spaceUrl: "https://x.com/i/spaces/1crossTenant" }),
      })
    );
    const { captureId } = await createRes.json();

    const { POST: completeSpace } = await import(
      "../../src/app/api/v1/spaces/[captureId]/complete/route"
    );
    const completeRes = await completeSpace(
      authedRequest(`https://test.local/api/v1/spaces/${captureId}/complete`, ghostWriteToken, {
        method: "POST",
      }),
      { params: Promise.resolve({ captureId }) }
    );
    expect(completeRes.status).toBe(404);
  });

  it.skipIf(!r2Ready)(
    "full round trip: create -> real PUT to R2 -> complete -> row updated -> bytes readable back",
    async () => {
      const { POST: createSpace } = await import("../../src/app/api/v1/spaces/route");
      const createRes = await createSpace(
        authedRequest("https://test.local/api/v1/spaces", writeToken, {
          method: "POST",
          body: JSON.stringify({
            spaceUrl: "https://x.com/i/spaces/1e2eRoundTrip",
            title: "E2E Round Trip Space",
            hostHandle: "e2e_host",
            durationS: 43, // download_space.sh pre-rounds yt-dlp's float `duration` before sending
            transcript: "hello from the e2e test",
          }),
        })
      );
      expect(createRes.status).toBe(200);
      const { captureId, uploadUrl } = await createRes.json();
      expect(captureId).toBeTruthy();
      expect(uploadUrl).toMatch(/^https:\/\//);

      const storageKey = `assets/${TENANT}/spaces/${captureId}.mp3`;
      cleanupKeys.push(storageKey);

      // Real PUT to the presigned URL — the exact step download_space.sh performs.
      const fakeMp3 = new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0]); // "ID3" header, tiny fake mp3
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: fakeMp3,
      });
      expect(putRes.ok).toBe(true);
      expect(await r2ObjectExists(storageKey)).toBe(true);

      const { POST: completeSpace } = await import(
        "../../src/app/api/v1/spaces/[captureId]/complete/route"
      );
      const completeRes = await completeSpace(
        authedRequest(`https://test.local/api/v1/spaces/${captureId}/complete`, writeToken, {
          method: "POST",
        }),
        { params: Promise.resolve({ captureId }) }
      );
      expect(completeRes.status).toBe(200);

      const { data: row } = await admin
        .from("saved_content")
        .select("extraction_status, stored_path, stored_mime, duration_sec, title, notes, author_handle")
        .eq("id", captureId)
        .single();
      expect(row?.extraction_status).toBe("extracted");
      expect(row?.stored_path).toBe(storageKey);
      expect(row?.stored_mime).toBe("audio/mpeg");
      expect(row?.duration_sec).toBe(43);
      expect(row?.title).toBe("E2E Round Trip Space");
      expect(row?.notes).toBe("hello from the e2e test");
      expect(row?.author_handle).toBe("e2e_host");

      // The vault download proxy / inline player both read via publicUrlFor().
      const publicUrl = publicUrlFor(row!.stored_path);
      expect(publicUrl).toBeTruthy();
      const readBack = await fetch(publicUrl!);
      expect(readBack.ok).toBe(true);
      const bytes = new Uint8Array(await readBack.arrayBuffer());
      expect(Array.from(bytes)).toEqual(Array.from(fakeMp3));
    }
  );
});
