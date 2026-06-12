// Per-tenant "discovery sources" — what platforms a tenant wants to mine for
// prospects. Generic: each source is a set of crawl URLs + globs run through
// Apify's website-content-crawler; the crawler extracts Instagram handles and
// upserts them as prospects. Gruve mines ticketing sites; Sippy can mine drinks
// platforms; any future tenant configures its own.
//
// Config is stored in tenants.settings.discovery (JSONB) so no table is needed.

export interface DiscoverySource {
  id: string; // stable slug, e.g. "eventbrite", "drinks_ng"
  label: string;
  startUrls: string[];
  includeUrlGlobs: string[];
  excludeUrlGlobs?: string[];
}

export interface TenantDiscoveryConfig {
  enabled: boolean;
  signalType: string; // 'ticketing_platform' | 'platform_discovery'
  limitPerSource: number;
  maxCandidates: number;
  sources: DiscoverySource[];
}

export const DEFAULT_LIMITS = { limitPerSource: 50, maxCandidates: 300 };

// Gruve's historical behavior, expressed as discovery sources. Used as the
// fallback when the gruve tenant has no explicit config — so the existing
// ticketing lead-gen keeps working untouched after generalization.
export const GRUVE_TICKETING_DEFAULT: TenantDiscoveryConfig = {
  enabled: true,
  signalType: "ticketing_platform",
  limitPerSource: DEFAULT_LIMITS.limitPerSource,
  maxCandidates: DEFAULT_LIMITS.maxCandidates,
  sources: [
    {
      id: "jetron",
      label: "Jetron",
      startUrls: ["https://jetron.ng/events"],
      includeUrlGlobs: ["https://jetron.ng/events/*", "https://jetron.ng/e/*"],
    },
    {
      id: "eventbrite",
      label: "Eventbrite",
      startUrls: [
        "https://www.eventbrite.com/d/nigeria/events/",
        "https://www.eventbrite.com/d/nigeria--lagos/events/",
        "https://www.eventbrite.com/d/nigeria--abuja/events/",
      ],
      includeUrlGlobs: ["https://www.eventbrite.com/e/*"],
    },
    {
      id: "luma",
      label: "Luma",
      startUrls: [
        "https://lu.ma/discover?location=lagos",
        "https://lu.ma/discover?location=nigeria",
        "https://lu.ma/discover?location=abuja",
      ],
      includeUrlGlobs: ["https://lu.ma/*"],
      excludeUrlGlobs: ["https://lu.ma/discover*", "https://lu.ma/user/*"],
    },
    {
      id: "tix_africa",
      label: "Tix.africa",
      startUrls: ["https://tix.africa"],
      includeUrlGlobs: ["https://tix.africa/*"],
      excludeUrlGlobs: ["https://tix.africa/blog/*", "https://tix.africa/about*"],
    },
  ],
};

interface TenantLike {
  slug: string;
  settings?: Record<string, unknown> | null;
}

// Coerce loosely-typed JSON from settings into a safe config (drops malformed
// sources). Returns null when discovery isn't configured/enabled for a tenant
// (with Gruve falling back to its ticketing default so nothing breaks).
export function getDiscoveryConfig(
  tenant: TenantLike
): TenantDiscoveryConfig | null {
  const raw = tenant.settings?.discovery as
    | Partial<TenantDiscoveryConfig>
    | undefined;

  if (raw && Array.isArray(raw.sources)) {
    const sources = raw.sources
      .filter(
        (s): s is DiscoverySource =>
          !!s &&
          typeof s.id === "string" &&
          Array.isArray(s.startUrls) &&
          s.startUrls.length > 0 &&
          Array.isArray(s.includeUrlGlobs)
      )
      .map((s) => ({
        id: s.id,
        label: s.label || s.id,
        startUrls: s.startUrls,
        includeUrlGlobs: s.includeUrlGlobs,
        excludeUrlGlobs: s.excludeUrlGlobs,
      }));
    if (raw.enabled === false || sources.length === 0) return null;
    return {
      enabled: true,
      signalType: raw.signalType || "platform_discovery",
      limitPerSource: raw.limitPerSource || DEFAULT_LIMITS.limitPerSource,
      maxCandidates: raw.maxCandidates || DEFAULT_LIMITS.maxCandidates,
      sources,
    };
  }

  // Backward-compat: gruve keeps its built-in ticketing scrape with no config.
  if (tenant.slug === "gruve") return GRUVE_TICKETING_DEFAULT;
  return null;
}
