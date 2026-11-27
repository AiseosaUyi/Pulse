import dns from "node:dns/promises";
import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";

export type EmailEvidenceStatus =
  | "VERIFIED"
  | "NOT_ON_PAGE"
  | "HIDDEN_CF"
  | "PAGE_BLOCKED"
  | "PAGE_ERROR"
  | "NO_MX"
  | "FREE_MAIL"
  | "DOMAIN_MISMATCH"
  | "SOURCE_OFFSITE"
  | "NO_SOURCE"
  | "NO_WEBSITE";

export interface PureEmailEvidenceInput {
  email?: string | null;
  website?: string | null;
  emailSourceUrl?: string | null;
  pageHtml?: string | null;
  pageStatus?: number | null;
  pageError?: string | null;
  mxRecords?: Array<{ exchange: string; priority: number }> | null;
  hasARecordOnly?: boolean;
  emailDomainRedirectsToSite?: boolean;
}

export interface EmailEvidenceDecision {
  status: EmailEvidenceStatus;
  verified: boolean;
  reason: string;
}

export const FREE_MAILBOX_REGEX =
  /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|proton|protonmail|gmx|mail|yandex|qq|163|126|naver|hanmail|web|t-online|orange|free|libero|wanadoo|zoho)\./i;

/**
 * Registrable domain, aware of two-level country suffixes like .co.uk, .com.ng, .com.au, .co.za
 */
export function getRegistrableDomain(hostOrUrl?: string | null): string {
  if (!hostOrUrl) return "";
  let host = hostOrUrl.trim().toLowerCase();
  try {
    if (host.includes("://")) {
      host = new URL(host).hostname;
    }
  } catch {
    // Keep raw string if not a full URL
  }
  host = host.replace(/^www\./, "").split("/")[0].split(":")[0].split("?")[0];
  const parts = host.split(".");
  if (parts.length <= 2) return host;

  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const isTwoLevelCountrySuffix =
    tld.length === 2 &&
    /^(co|com|org|net|ac|gov|or|ne|gv|edu|sch|mil|biz|info)$/.test(sld);

  if (isTwoLevelCountrySuffix && parts.length > 2) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/**
 * Extract clean hostname without www or scheme
 */
export function getHostname(hostOrUrl?: string | null): string {
  if (!hostOrUrl) return "";
  let host = hostOrUrl.trim().toLowerCase();
  try {
    if (host.includes("://")) {
      host = new URL(host).hostname;
    }
  } catch {}
  return host.replace(/^www\./, "").split("/")[0].split(":")[0].split("?")[0];
}

/**
 * Decode HTML entities and %40, but NEVER decode Cloudflare email protection
 */
export function decodeHtmlForEmail(html: string): string {
  if (!html) return "";
  return html
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/%40/gi, "@")
    .replace(/&commat;/gi, "@")
    .toLowerCase();
}

/**
 * Pure decision function for email evidence without network calls.
 * Unit-testable for all status codes.
 */
export function evaluateEmailEvidence(input: PureEmailEvidenceInput): EmailEvidenceDecision {
  const email = (input.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { status: "NO_SOURCE", verified: false, reason: "No email provided" };
  }

  const website = (input.website || "").trim();
  if (!website) {
    return { status: "NO_WEBSITE", verified: false, reason: "Company website is required" };
  }

  const emailSourceUrl = (input.emailSourceUrl || "").trim();
  if (!emailSourceUrl) {
    return { status: "NO_SOURCE", verified: false, reason: "email_source_url is required" };
  }

  const siteReg = getRegistrableDomain(website);
  const sourceReg = getRegistrableDomain(emailSourceUrl);

  if (!siteReg || !sourceReg || siteReg !== sourceReg) {
    return {
      status: "SOURCE_OFFSITE",
      verified: false,
      reason: `Email source (${sourceReg || emailSourceUrl}) is not on company's own site (${siteReg || website})`,
    };
  }

  const emailDomain = email.split("@")[1]?.toLowerCase() || "";
  if (!emailDomain) {
    return { status: "DOMAIN_MISMATCH", verified: false, reason: "Invalid email domain" };
  }

  if (FREE_MAILBOX_REGEX.test(emailDomain)) {
    return {
      status: "FREE_MAIL",
      verified: false,
      reason: `Free mailbox (${emailDomain}) is not permitted for verified B2B outreach`,
    };
  }

  const siteHost = getHostname(website);
  const emailHost = getHostname(emailDomain);
  const emailDomainReg = getRegistrableDomain(emailDomain);

  let domainMatches = siteHost === emailHost || siteReg === emailDomainReg;

  // Suffix brand exception: same brand prefix across different country suffixes (e.g. acme.com.ng vs acme.ng)
  const siteBrand = siteReg.split(".")[0];
  const emailBrand = emailDomainReg.split(".")[0];
  const isSameBrandDifferentSuffix = siteBrand === emailBrand && siteReg !== emailDomainReg;

  if (isSameBrandDifferentSuffix) {
    if (input.emailDomainRedirectsToSite) {
      domainMatches = true;
    } else {
      return {
        status: "DOMAIN_MISMATCH",
        verified: false,
        reason: `Email domain (${emailDomain}) brand matches site (${website}) but does not redirect to the website's domain`,
      };
    }
  }

  if (!domainMatches) {
    return {
      status: "DOMAIN_MISMATCH",
      verified: false,
      reason: `Email domain (${emailDomain}) does not equal website domain (${siteHost})`,
    };
  }

  // MX record check
  if (input.hasARecordOnly) {
    return {
      status: "NO_MX",
      verified: false,
      reason: `Email domain (${emailDomain}) has A record only, no MX records`,
    };
  }

  const mx = input.mxRecords || [];
  const realMx = mx.filter((m) => m.exchange && m.exchange !== ".");
  if (realMx.length === 0) {
    return {
      status: "NO_MX",
      verified: false,
      reason: `Email domain (${emailDomain}) has no valid MX records`,
    };
  }

  // Page response checks
  if (input.pageError) {
    return {
      status: "PAGE_ERROR",
      verified: false,
      reason: `Failed fetching email source page: ${input.pageError}`,
    };
  }

  if (input.pageStatus && (input.pageStatus < 200 || input.pageStatus >= 400)) {
    return {
      status: "PAGE_BLOCKED",
      verified: false,
      reason: `Email source page returned HTTP status ${input.pageStatus}`,
    };
  }

  const rawHtml = input.pageHtml || "";
  const decoded = decodeHtmlForEmail(rawHtml);

  if (containsExactEmail(decoded, email)) {
    return {
      status: "VERIFIED",
      verified: true,
      reason: "Email verified on company's own page with working MX records",
    };
  }

  // Never decode Cloudflare email protection
  if (/__cf_email__|cdn-cgi\/l\/email-protection/i.test(rawHtml)) {
    return {
      status: "HIDDEN_CF",
      verified: false,
      reason: "Email is protected by Cloudflare email protection (__cf_email__ / cdn-cgi)",
    };
  }

  return {
    status: "NOT_ON_PAGE",
    verified: false,
    reason: "Email address not found in raw HTML of email_source_url",
  };
}

// ── SSRF Guard & Network Fetcher ─────────────────────────────────────────────

/**
 * True when `email` appears in `text` as a whole address, not as the tail of a
 * longer one (fo@acme.com must not match info@acme.com).
 */
export function containsExactEmail(text: string, email: string): boolean {
  if (!email) return false;
  const escaped = email.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9._%+-])${escaped}($|[^a-z0-9.-]|\\.(?![a-z0-9]))`, "i");
  return re.test(text);
}

function ipv4Blocked(ip: string): boolean {
  const [b0, b1] = ip.split(".").map(Number);
  if (b0 === 127) return true; // loopback
  if (b0 === 10) return true; // private
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // private
  if (b0 === 192 && b1 === 168) return true; // private
  if (b0 === 169 && b1 === 254) return true; // link-local / cloud metadata
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // 100.64/10 CGNAT
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true; // 198.18/15 benchmarking
  if (b0 === 192 && b1 === 0) return true; // 192.0.0/24 + 192.0.2/24
  if (b0 === 0) return true; // 0.0.0.0/8
  if (b0 >= 224) return true; // multicast / reserved
  return false;
}

/** Embedded IPv4 from ::ffff:a.b.c.d or ::ffff:hhhh:hhhh, else null. */
function mappedIpv4(lower: string): string | null {
  const m = lower.match(/^(?:0{0,4}:){0,5}:?ffff:(.+)$/) ?? lower.match(/^::ffff:(.+)$/);
  if (!m) return null;
  const tail = m[1];
  if (net.isIPv4(tail)) return tail;
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/**
 * Blocks private, reserved and metadata IP ranges (IPv4 and IPv6, including
 * IPv4-mapped and NAT64 forms).
 */
export function isPrivateOrMetadataIp(ip: string): boolean {
  if (!ip) return true;
  if (net.isIPv4(ip)) return ipv4Blocked(ip);

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = mappedIpv4(lower);
    if (mapped) return ipv4Blocked(mapped);
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
    if (lower.startsWith("ff")) return true; // multicast
    if (lower.startsWith("64:ff9b:")) return true; // NAT64 can reach IPv4 internals
    if (lower.startsWith("2001:db8:")) return true; // documentation
    return false;
  }

  return true;
}

export async function checkHostSsrf(hostname: string): Promise<boolean> {
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses.length) return false;
    for (const addr of addresses) {
      if (isPrivateOrMetadataIp(addr.address)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * DNS lookup used at socket-connect time. Validating here, on the exact
 * addresses the socket will use, closes the DNS-rebinding gap between a
 * pre-check and the real connection.
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | number,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
): void {
  const opts = typeof options === "number" ? { family: options } : options ?? {};
  dnsLookupCb(hostname, { all: true, family: opts.family as 0 | 4 | 6 | undefined }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateOrMetadataIp(a.address))) {
      const e: NodeJS.ErrnoException = new Error("blocked destination");
      e.code = "ESSRFBLOCKED";
      return callback(e, "");
    }
    if (opts.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

interface GuardedResponse {
  status: number;
  location: string | null;
  body: string;
}

/**
 * One GET with the connect-time SSRF guard, a hard deadline covering headers
 * AND body, and a body size cap. Never follows redirects itself.
 */
function guardedGet(urlStr: string, timeoutMs: number, readBody: boolean): Promise<GuardedResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    // Node never calls `lookup` for an IP-literal host, so check those here.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && isPrivateOrMetadataIp(literal)) {
      const e: NodeJS.ErrnoException = new Error("blocked destination");
      e.code = "ESSRFBLOCKED";
      return reject(e);
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup as unknown as typeof dnsLookupCb,
        headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = (res.headers.location as string | undefined) ?? null;
        if (!readBody || (status >= 300 && status < 400)) {
          res.resume();
          req.destroy();
          return finish(() => resolve({ status, location, body: "" }));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            // Keep what we have. A contact email past 2 MB of HTML is not worth the risk.
            req.destroy();
            return finish(() => resolve({ status, location, body: Buffer.concat(chunks).toString("utf8") }));
          }
          chunks.push(chunk);
        });
        res.on("end", () => finish(() => resolve({ status, location, body: Buffer.concat(chunks).toString("utf8") })));
        res.on("error", (e) => finish(() => reject(e)));
      }
    );

    const timer = setTimeout(() => {
      req.destroy(new Error("timeout"));
      finish(() => reject(new Error("timeout")));
    }, timeoutMs);

    req.on("error", (e) => finish(() => reject(e)));
    req.end();
  });
}

/** Generic error text only: the reason is returned to the caller, so it must
 * not reveal internal network detail. */
function fetchErrorReason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ESSRFBLOCKED") return "Destination not allowed";
  if (err instanceof Error && err.message === "timeout") return "Timed out";
  return "Could not fetch page";
}

/**
 * Safe fetch with an SSRF guard enforced at connect time on every hop,
 * a 12s deadline covering the body read, and a 2 MB body cap.
 */
export async function safeFetchHtml(urlStr: string): Promise<{ status: number; html: string; error?: string }> {
  let currentUrl = urlStr;
  const timeoutMs = 12000;
  const maxRedirects = 5;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { status: 0, html: "", error: "Invalid URL" };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { status: 0, html: "", error: "Unsupported protocol" };
    }
    if (parsed.username || parsed.password) {
      return { status: 0, html: "", error: "Destination not allowed" };
    }

    try {
      const res = await guardedGet(currentUrl, timeoutMs, true);
      if (res.status >= 300 && res.status < 400) {
        if (!res.location) {
          return { status: res.status, html: "", error: "Redirect missing location header" };
        }
        currentUrl = new URL(res.location, currentUrl).href;
        continue;
      }
      return { status: res.status, html: res.body };
    } catch (err: unknown) {
      return { status: 0, html: "", error: fetchErrorReason(err) };
    }
  }

  return { status: 0, html: "", error: "Too many redirects" };
}

/**
 * Check DNS MX records for domain
 */
export async function resolveMxRecords(domain: string): Promise<{
  mxRecords: Array<{ exchange: string; priority: number }>;
  hasARecordOnly: boolean;
}> {
  try {
    const mx = await dns.resolveMx(domain);
    const valid = mx.filter((m) => m.exchange && m.exchange !== ".");
    return { mxRecords: valid, hasARecordOnly: false };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      try {
        const a = await dns.resolve4(domain);
        if (a && a.length > 0) {
          return { mxRecords: [], hasARecordOnly: true };
        }
      } catch {}
    }
    return { mxRecords: [], hasARecordOnly: false };
  }
}

/**
 * Check if sibling domain redirects to website
 */
export async function checkSiblingDomainRedirect(emailDomain: string, websiteUrl: string): Promise<boolean> {
  try {
    const testUrl = `https://${emailDomain}`;
    let parsed: URL;
    try {
      parsed = new URL(testUrl);
    } catch {
      return false;
    }

    const res = await guardedGet(parsed.href, 6000, false);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.location;
      if (loc) {
        const destHost = getHostname(new URL(loc, testUrl).href);
        const targetHost = getHostname(websiteUrl);
        return destHost === targetHost || getRegistrableDomain(destHost) === getRegistrableDomain(targetHost);
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Full network-enabled verification runner
 */
export async function verifyEmailEvidence(
  email: string,
  website: string,
  emailSourceUrl?: string | null
): Promise<EmailEvidenceDecision> {
  if (!emailSourceUrl) {
    return { status: "NO_SOURCE", verified: false, reason: "No email_source_url provided" };
  }

  // Pre-validate domains before hitting network
  const siteReg = getRegistrableDomain(website);
  const sourceReg = getRegistrableDomain(emailSourceUrl);
  if (!siteReg || !sourceReg || siteReg !== sourceReg) {
    return evaluateEmailEvidence({
      email,
      website,
      emailSourceUrl,
    });
  }

  const emailDomain = email.split("@")[1]?.toLowerCase() || "";
  if (FREE_MAILBOX_REGEX.test(emailDomain)) {
    return evaluateEmailEvidence({
      email,
      website,
      emailSourceUrl,
    });
  }

  const emailDomainReg = getRegistrableDomain(emailDomain);
  const siteBrand = siteReg.split(".")[0];
  const emailBrand = emailDomainReg.split(".")[0];
  let emailDomainRedirectsToSite = false;

  if (siteBrand === emailBrand && siteReg !== emailDomainReg) {
    emailDomainRedirectsToSite = await checkSiblingDomainRedirect(emailDomain, website);
  }

  // Fetch DNS MX and Source HTML in parallel
  const [dnsResult, fetchResult] = await Promise.all([
    resolveMxRecords(emailDomain),
    safeFetchHtml(emailSourceUrl),
  ]);

  return evaluateEmailEvidence({
    email,
    website,
    emailSourceUrl,
    pageHtml: fetchResult.html,
    pageStatus: fetchResult.status,
    pageError: fetchResult.error,
    mxRecords: dnsResult.mxRecords,
    hasARecordOnly: dnsResult.hasARecordOnly,
    emailDomainRedirectsToSite,
  });
}
