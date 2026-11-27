import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  normalizeEmail,
  normalizeHandle,
  normalizePhone,
  normalizeLedgerKey,
} from "@/lib/services/outreach-ledger";

describe("Ledger Key Normalisation", () => {
  describe("normalizeDomain", () => {
    it("strips schemes, www, paths, queries, ports, and lowercases", () => {
      expect(normalizeDomain("https://www.Acme.com/about?ref=123")).toBe("acme.com");
      expect(normalizeDomain("http://SUB.EXAMPLE.CO.UK:8080/path")).toBe("sub.example.co.uk");
      expect(normalizeDomain("WWW.EXAMPLE.COM.NG")).toBe("example.com.ng");
      expect(normalizeDomain("example.ng/")).toBe("example.ng");
      expect(normalizeDomain("")).toBe("");
      expect(normalizeDomain(null)).toBe("");
    });
  });

  describe("normalizeEmail", () => {
    it("lowercases and trims whitespace", () => {
      expect(normalizeEmail("  Hello@Acme.COM  ")).toBe("hello@acme.com");
      expect(normalizeEmail("info@example.com.ng")).toBe("info@example.com.ng");
      expect(normalizeEmail("")).toBe("");
    });
  });

  describe("normalizeHandle", () => {
    it("strips leading @, lowercases, and trims", () => {
      expect(normalizeHandle("@AcmeLagos")).toBe("acmelagos");
      expect(normalizeHandle("@@BrandName ")).toBe("brandname");
      expect(normalizeHandle("simple_handle")).toBe("simple_handle");
      expect(normalizeHandle("")).toBe("");
    });
  });

  describe("normalizePhone", () => {
    it("normalises Nigerian domestic numbers to E.164", () => {
      expect(normalizePhone("08012345678")).toBe("+2348012345678");
      expect(normalizePhone("070 9876 5432")).toBe("+2347098765432");
      expect(normalizePhone("090-111-222-33")).toBe("+2349011122233");
    });

    it("preserves international E.164 numbers", () => {
      expect(normalizePhone("+2348012345678")).toBe("+2348012345678");
      expect(normalizePhone("+1 (555) 234-5678")).toBe("+15552345678");
      expect(normalizePhone("+44 20 7946 0912")).toBe("+442079460912");
    });
  });

  describe("normalizeLedgerKey", () => {
    it("dispatches correctly per key type", () => {
      expect(normalizeLedgerKey("DOMAIN", "https://www.Gruve.events/")).toBe("gruve.events");
      expect(normalizeLedgerKey("EMAIL", "Hi@Gruve.events")).toBe("hi@gruve.events");
      expect(normalizeLedgerKey("HANDLE", "@gruve_events")).toBe("gruve_events");
      expect(normalizeLedgerKey("PHONE", "08012345678")).toBe("+2348012345678");
    });
  });
});
