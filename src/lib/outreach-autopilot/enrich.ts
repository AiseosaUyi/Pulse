// Finds a lead's email so Autopilot has someone to write to.
//
// For a lead with no email yet:
//   1. website: the lead's own `website`, else a non-social link in its bio,
//      else one web search for its name (Serper only; never the paid
//      fallback). A search hit must share a word with the lead's name.
//   2. read the site's home, contact and about pages (SSRF-guarded fetch)
//      and collect addresses on the site's own domain.
//   3. keep one only if verifyEmailEvidence passes (on the page, same domain,
//      real MX, not a free mailbox). Never guesses an address.
//
// Found: email + email_source_url + email_status='verified' (website filled
// only if it was empty). A site found by search adds a review note to the
// draft, so the approver checks it's the right business. Nothing found:
// only email_searched_at/email_search_note change. Each lead is searched at
// most once per RETRY_DAYS.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decodeHtmlForEmail,
  FREE_MAILBOX_REGEX,
  getRegistrableDomain,
  safeFetchHtml,
  verifyEmailEvidence,
} from "@/lib/outbound/email-evidence";
import { scrapeViaSerper, isSerperConfigured } from "@/lib/scrape/serper-serp";
import { ledgerCheck } from "@/lib/services/outreach-ledger";

const RETRY_DAYS = 30;
const PAGES = ["", "/contact", "/contact-us", "/about"];

/** Sites that are never a business's own website. */
const NOT_A_BUSINESS_SITE =
  /(^|\.)(instagram|facebook|fb|tiktok|twitter|x|linkedin|youtube|youtu|wa|whatsapp|threads|snapchat|pinterest|linktr|linktree|beacons|bio|lnk|campsite|taplink|google|goo|bit|tinyurl|t|eventbrite|tix|tixafrica|nairabox|shows|egotickets|lu|luma|jetron|ticketmaster|paystack|flutterwave|selar|wikipedia|tripadvisor|yelp|nairaland|medium|substack|wordpress|blogspot|wixsite|carrd|gruve|sippy)\.[a-z.]+$/i;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const STOP = new Set(["the", "and", "events", "event", "ltd", "limited", "nigeria", "lagos", "abuja", "official", "group", "company", "co", "ng", "team"]);

export interface EnrichCandidate {
  id: string;
  handle: string | null;
  display_name: string | null;
  company_name: string | null;
  website: string | null;
  bio: string | null;
  city: string | null;
}

export interface EnrichResult {
  checked: number;
  found: number;
  searches: number;
}

export function nameWords(...names: (string | null | undefined)[]): string[] {
  const words = names
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[@_.\-]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set(words)];
}

export function isBusinessSite(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return !NOT_A_BUSINESS_SITE.test(u.hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

/** First non-social link in a bio. */
export function siteFromBio(bio: string | null): string | null {
  if (!bio) return null;
  const urls = bio.match(/https?:\/\/[^\s)<>"']+|(?:www\.)[a-z0-9-]+\.[a-z.]{2,}[^\s)<>"']*/gi) ?? [];
  for (const raw of urls) {
    const u = raw.startsWith("http") ? raw : `https://${raw}`;
    if (isBusinessSite(u)) return u;
  }
  return null;
}

/** A search hit counts only if its domain or title shares a word with the lead's name. */
export function matchesName(result: { url: string; title: string }, words: string[]): boolean {
  if (!words.length || !isBusinessSite(result.url)) return false;
  const hay = `${getRegistrableDomain(result.url)} ${result.title}`.toLowerCase();
  return words.some((w) => hay.includes(w));
}

/** Addresses on the site's own domain found in a page, role addresses first. */
export function emailsOnPage(html: string, site: string): string[] {
  const siteReg = getRegistrableDomain(site);
  const found = new Set<string>();
  for (const m of decodeHtmlForEmail(html).match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase().replace(/\.+$/, "");
    const domain = e.split("@")[1] ?? "";
    if (FREE_MAILBOX_REGEX.test(domain)) continue;
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(e)) continue;
    if (getRegistrableDomain(domain) !== siteReg) continue;
    found.add(e);
  }
  const role = /^(hello|info|contact|sales|bookings?|enquir(y|ies)|events?|admin|team|support)@/;
  return [...found].sort((a, b) => Number(role.test(b)) - Number(role.test(a)));
}

async function findSite(
  c: EnrichCandidate,
  budget: { searches: number }
): Promise<{ site: string | null; viaSearch: boolean; note?: string }> {
  if (c.website && isBusinessSite(c.website.startsWith("http") ? c.website : `https://${c.website}`)) {
    return { site: c.website.startsWith("http") ? c.website : `https://${c.website}`, viaSearch: false };
  }
  const fromBio = siteFromBio(c.bio);
  if (fromBio) return { site: fromBio, viaSearch: false };

  const words = nameWords(c.company_name, c.display_name, c.handle);
  const name = c.company_name || c.display_name || c.handle;
  if (!name || !words.length) return { site: null, viaSearch: false, note: "no name to search" };
  if (!isSerperConfigured()) return { site: null, viaSearch: false, note: "search not configured" };
  if (budget.searches <= 0) return { site: null, viaSearch: false, note: "search budget used" };

  budget.searches--;
  try {
    const results = await scrapeViaSerper({ query: `"${name}" ${c.city ?? ""} contact email`.trim(), limit: 8 });
    const hit = results.find((r) => matchesName(r, words));
    if (!hit) return { site: null, viaSearch: true, note: "no matching website in search" };
    const u = new URL(hit.url);
    return { site: `${u.protocol}//${u.host}`, viaSearch: true };
  } catch (err) {
    return { site: null, viaSearch: true, note: `search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function findEmail(site: string): Promise<{ email: string; sourceUrl: string } | null> {
  const origin = new URL(site).origin;
  for (const path of PAGES) {
    const url = `${origin}${path}`;
    const page = await safeFetchHtml(url);
    if (page.status < 200 || page.status >= 300 || !page.html) continue;
    for (const email of emailsOnPage(page.html, origin).slice(0, 3)) {
      const v = await verifyEmailEvidence(email, origin, url);
      if (v.status === "VERIFIED") return { email, sourceUrl: url };
    }
  }
  return null;
}

/**
 * Lead statuses worth an email, best first. A lead that replied or was
 * qualified is closer to a sale than a fresh one, so it gets searched first.
 * Closed, dismissed and unqualified leads are never searched.
 */
export const ENRICH_STATUS_TIERS: readonly (readonly string[])[] = [
  ["replied"],
  ["qualified"],
  ["new", "qualifying"],
];

/**
 * Up to `limit` leads with no email yet and not searched in RETRY_DAYS,
 * by tier (ENRICH_STATUS_TIERS), newest first inside a tier. PostgREST can't
 * order by a custom status rank, so this runs one small query per tier.
 */
export async function selectEnrichCandidates(
  admin: SupabaseClient,
  tenantSlug: string,
  limit: number,
  retryBefore: string
): Promise<EnrichCandidate[]> {
  const out: EnrichCandidate[] = [];
  for (const statuses of ENRICH_STATUS_TIERS) {
    const left = limit - out.length;
    if (left <= 0) break;
    const { data, error } = await admin
      .from("prospects")
      .select("id, handle, display_name, company_name, website, bio, city")
      .eq("tenant_slug", tenantSlug)
      .is("email_status", null)
      .in("status", [...statuses])
      .or(`email_searched_at.is.null,email_searched_at.lt.${retryBefore}`)
      .order("created_at", { ascending: false })
      .limit(left);
    if (error) throw new Error(`find emails: ${error.message}`);
    out.push(...((data ?? []) as EnrichCandidate[]));
  }
  return out;
}

/**
 * Look for emails for up to `limit` leads in this workspace. Returns counts.
 * Stops early at `deadlineMs`.
 */
export async function findEmailsForTenant(
  admin: SupabaseClient,
  tenantSlug: string,
  opts: { limit: number; searchBudget: number; now?: Date; deadlineMs?: number }
): Promise<EnrichResult> {
  const now = opts.now ?? new Date();
  const res: EnrichResult = { checked: 0, found: 0, searches: 0 };
  const retryBefore = new Date(now.getTime() - RETRY_DAYS * 86_400_000).toISOString();

  const candidates = await selectEnrichCandidates(admin, tenantSlug, opts.limit, retryBefore);

  const budget = { searches: opts.searchBudget };
  for (const c of candidates) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    res.checked++;
    const before = budget.searches;
    const { site, viaSearch, note } = await findSite(c, budget);
    res.searches += before - budget.searches;

    let found: { email: string; sourceUrl: string } | null = null;
    let why = note ?? null;
    if (site) {
      const ledger = await ledgerCheck(admin, tenantSlug, { domain: site }).catch(() => null);
      if (ledger?.inLedger) why = `website ${getRegistrableDomain(site)} already in ledger`;
      else {
        found = await findEmail(site).catch(() => null);
        if (!found) why = `no verifiable email on ${getRegistrableDomain(site)}`;
      }
    }

    const patch: Record<string, unknown> = {
      email_searched_at: now.toISOString(),
      email_search_note: found
        ? viaSearch
          ? `Website found by web search: ${getRegistrableDomain(site!)}. Check it is the right business.`
          : `Email found on ${found.sourceUrl}`
        : (why ?? "nothing found"),
    };
    if (found) {
      Object.assign(patch, {
        email: found.email,
        email_source_url: found.sourceUrl,
        email_status: "verified",
      });
      if (!c.website) patch.website = site;
      res.found++;
    }
    await admin
      .from("prospects")
      .update(patch)
      .eq("tenant_slug", tenantSlug)
      .eq("id", c.id)
      .is("email_status", null); // never overwrite an email set meanwhile
  }
  return res;
}
