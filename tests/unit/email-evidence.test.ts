import { describe, it, expect } from "vitest";
import {
  evaluateEmailEvidence,
  getRegistrableDomain,
  decodeHtmlForEmail,
  isPrivateOrMetadataIp,
} from "@/lib/outbound/email-evidence";

describe("Email Evidence Verification Logic", () => {
  describe("getRegistrableDomain", () => {
    it("handles two-level country suffixes correctly", () => {
      expect(getRegistrableDomain("https://www.company.co.uk/contact")).toBe("company.co.uk");
      expect(getRegistrableDomain("https://blog.sub.acme.com.ng/team")).toBe("acme.com.ng");
      expect(getRegistrableDomain("https://store.brand.com.au")).toBe("brand.com.au");
      expect(getRegistrableDomain("lounge.co.za")).toBe("lounge.co.za");
    });

    it("handles standard single-level TLDs", () => {
      expect(getRegistrableDomain("https://www.example.com/about")).toBe("example.com");
      expect(getRegistrableDomain("sub.domain.org")).toBe("domain.org");
      expect(getRegistrableDomain("https://gruve.events")).toBe("gruve.events");
      expect(getRegistrableDomain("sippy.ng")).toBe("sippy.ng");
    });
  });

  describe("decodeHtmlForEmail", () => {
    it("decodes HTML entities and %40 but leaves other content intact", () => {
      expect(decodeHtmlForEmail("contact&#64;acme.com")).toBe("contact@acme.com");
      expect(decodeHtmlForEmail("hello&#x40;gruve.events")).toBe("hello@gruve.events");
      expect(decodeHtmlForEmail("orders%40sippy.ng")).toBe("orders@sippy.ng");
      expect(decodeHtmlForEmail("info&commat;venue.com")).toBe("info@venue.com");
    });
  });

  describe("SSRF guard", () => {
    it("flags loopback, private, and cloud metadata IPs", () => {
      expect(isPrivateOrMetadataIp("127.0.0.1")).toBe(true);
      expect(isPrivateOrMetadataIp("10.0.0.1")).toBe(true);
      expect(isPrivateOrMetadataIp("172.16.0.5")).toBe(true);
      expect(isPrivateOrMetadataIp("172.31.255.255")).toBe(true);
      expect(isPrivateOrMetadataIp("192.168.1.1")).toBe(true);
      expect(isPrivateOrMetadataIp("169.254.169.254")).toBe(true); // AWS/GCP metadata
      expect(isPrivateOrMetadataIp("::1")).toBe(true);
      expect(isPrivateOrMetadataIp("fc00::1")).toBe(true);
      expect(isPrivateOrMetadataIp("fe80::1")).toBe(true);
    });

    it("allows valid public IPs", () => {
      expect(isPrivateOrMetadataIp("1.1.1.1")).toBe(false);
      expect(isPrivateOrMetadataIp("8.8.8.8")).toBe(false);
      expect(isPrivateOrMetadataIp("142.250.190.46")).toBe(false);
    });
  });

  describe("evaluateEmailEvidence - All Status Codes", () => {
    const validBase = {
      email: "hello@acme.com",
      website: "https://acme.com",
      emailSourceUrl: "https://acme.com/contact",
      pageHtml: "<html><body>Contact us at hello@acme.com</body></html>",
      pageStatus: 200,
      mxRecords: [{ exchange: "mail.acme.com", priority: 10 }],
    };

    it("status: VERIFIED when all 4 conditions hold", () => {
      const res = evaluateEmailEvidence(validBase);
      expect(res.status).toBe("VERIFIED");
      expect(res.verified).toBe(true);
    });

    it("status: NO_SOURCE when email or email_source_url is missing", () => {
      expect(evaluateEmailEvidence({ ...validBase, email: "" }).status).toBe("NO_SOURCE");
      expect(evaluateEmailEvidence({ ...validBase, emailSourceUrl: "" }).status).toBe("NO_SOURCE");
    });

    it("status: NO_WEBSITE when website is missing", () => {
      expect(evaluateEmailEvidence({ ...validBase, website: "" }).status).toBe("NO_WEBSITE");
    });

    it("status: SOURCE_OFFSITE when email_source_url is on a different domain", () => {
      const res = evaluateEmailEvidence({
        ...validBase,
        emailSourceUrl: "https://directory.com/acme",
      });
      expect(res.status).toBe("SOURCE_OFFSITE");
      expect(res.verified).toBe(false);
    });

    it("status: FREE_MAIL when email domain is a free provider", () => {
      const freeProviders = [
        "acme@gmail.com",
        "acme@yahoo.com",
        "acme@hotmail.com",
        "acme@outlook.com",
        "acme@icloud.com",
        "acme@proton.me",
        "acme@protonmail.com",
        "acme@gmx.com",
      ];
      for (const email of freeProviders) {
        const res = evaluateEmailEvidence({
          ...validBase,
          email,
        });
        expect(res.status).toBe("FREE_MAIL");
        expect(res.verified).toBe(false);
      }
    });

    it("status: DOMAIN_MISMATCH when email domain differs from website domain", () => {
      const res = evaluateEmailEvidence({
        ...validBase,
        email: "hello@different.com",
      });
      expect(res.status).toBe("DOMAIN_MISMATCH");
      expect(res.verified).toBe(false);
    });

    it("status: DOMAIN_MISMATCH vs Sibling Redirect Exception", () => {
      // Sibling brand domain (acme.com.ng vs acme.ng) without redirect fails
      const noRedirect = evaluateEmailEvidence({
        ...validBase,
        email: "info@acme.com.ng",
        website: "https://acme.ng",
        emailSourceUrl: "https://acme.ng/contact",
        emailDomainRedirectsToSite: false,
      });
      expect(noRedirect.status).toBe("DOMAIN_MISMATCH");

      // Sibling brand domain WITH verified redirect passes
      const withRedirect = evaluateEmailEvidence({
        ...validBase,
        email: "info@acme.com.ng",
        website: "https://acme.ng",
        emailSourceUrl: "https://acme.ng/contact",
        pageHtml: "<html><body>info@acme.com.ng</body></html>",
        emailDomainRedirectsToSite: true,
      });
      expect(withRedirect.status).toBe("VERIFIED");
    });

    it("status: NO_MX when domain has null MX or A-record only", () => {
      const nullMx = evaluateEmailEvidence({
        ...validBase,
        mxRecords: [{ exchange: ".", priority: 0 }],
      });
      expect(nullMx.status).toBe("NO_MX");

      const emptyMx = evaluateEmailEvidence({
        ...validBase,
        mxRecords: [],
      });
      expect(emptyMx.status).toBe("NO_MX");

      const aRecordOnly = evaluateEmailEvidence({
        ...validBase,
        mxRecords: [],
        hasARecordOnly: true,
      });
      expect(aRecordOnly.status).toBe("NO_MX");
    });

    it("status: PAGE_BLOCKED when page returns 4xx or 5xx", () => {
      const blocked403 = evaluateEmailEvidence({
        ...validBase,
        pageStatus: 403,
      });
      expect(blocked403.status).toBe("PAGE_BLOCKED");

      const error500 = evaluateEmailEvidence({
        ...validBase,
        pageStatus: 500,
      });
      expect(error500.status).toBe("PAGE_BLOCKED");
    });

    it("status: PAGE_ERROR when fetch encounters network/SSRF error", () => {
      const res = evaluateEmailEvidence({
        ...validBase,
        pageError: "ETIMEDOUT",
      });
      expect(res.status).toBe("PAGE_ERROR");
    });

    it("status: HIDDEN_CF when Cloudflare email protection is present and address not in plain HTML", () => {
      const cfHtml = `
        <html>
          <body>
            Contact our team: <a href="/cdn-cgi/l/email-protection#12345">[email&#160;protected]</a>
            <script data-cfasync="false" src="/cdn-cgi/l/email-protection"></script>
          </body>
        </html>
      `;
      const res = evaluateEmailEvidence({
        ...validBase,
        pageHtml: cfHtml,
      });
      expect(res.status).toBe("HIDDEN_CF");
      expect(res.verified).toBe(false);
    });

    it("status: NOT_ON_PAGE when page loads ok but address is absent", () => {
      const res = evaluateEmailEvidence({
        ...validBase,
        pageHtml: "<html><body>Call us at +234 801 234 5678</body></html>",
      });
      expect(res.status).toBe("NOT_ON_PAGE");
      expect(res.verified).toBe(false);
    });
  });
});
