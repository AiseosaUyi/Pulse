import { describe, it, expect } from "vitest";
import http from "node:http";
import {
  containsExactEmail,
  isPrivateOrMetadataIp,
  safeFetchHtml,
  evaluateEmailEvidence,
} from "@/lib/outbound/email-evidence";

describe("containsExactEmail", () => {
  it("does not match the tail of a longer address", () => {
    expect(containsExactEmail("write to info@acme.com", "fo@acme.com")).toBe(false);
    expect(containsExactEmail("write to fo@acme.com.ng", "fo@acme.com")).toBe(false);
  });
  it("matches whole addresses in normal HTML", () => {
    expect(containsExactEmail('<a href="mailto:fo@acme.com">', "fo@acme.com")).toBe(true);
    expect(containsExactEmail("Email fo@acme.com.", "fo@acme.com")).toBe(true);
    expect(containsExactEmail("fo@acme.com", "fo@acme.com")).toBe(true);
  });
  it("is what evaluateEmailEvidence uses", () => {
    const r = evaluateEmailEvidence({
      email: "fo@acme.com",
      website: "https://acme.com",
      emailSourceUrl: "https://acme.com/contact",
      pageHtml: "info@acme.com",
      pageStatus: 200,
      mxRecords: [{ exchange: "mx.acme.com", priority: 10 }],
    });
    expect(r.status).toBe("NOT_ON_PAGE");
  });
});

describe("isPrivateOrMetadataIp", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "198.18.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe",
  ])("blocks %s", (ip) => expect(isPrivateOrMetadataIp(ip)).toBe(true));

  it.each(["8.8.8.8", "102.89.1.1", "2606:4700::1111"])("allows %s", (ip) =>
    expect(isPrivateOrMetadataIp(ip)).toBe(false)
  );
});

describe("safeFetchHtml SSRF guard", () => {
  it("refuses loopback IP literals without connecting", async () => {
    let hit = false;
    const server = http.createServer((_, res) => { hit = true; res.end("secret"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const r = await safeFetchHtml(`http://127.0.0.1:${port}/`);
      expect(r.error).toBe("Destination not allowed");
      expect(r.html).toBe("");
      expect(hit).toBe(false);
    } finally {
      server.close();
    }
  });

  it("refuses hostnames that resolve to loopback at connect time", async () => {
    const r = await safeFetchHtml("http://localhost:9/");
    expect(r.error).toBe("Destination not allowed");
  });
});
