// Supplementary SEO signals computed alongside the 0-100 rubric in
// score-blog.ts. These do NOT change the rubric total — that would
// break backward compat for non-SEO blog posts and force everyone to
// rebalance. Instead, the SeoPanel surfaces these signals separately
// as gauges + checkmarks.
//
// Why deterministic, not AI? Each signal here is mechanical text
// analysis — alt-tag presence, schema-block presence, link count,
// length comparison. Cheap to compute; no AI cost; instant feedback
// in the editor.
//
// Originality (embedding-similarity against SERP) is intentionally NOT
// here. It requires embeddings of competitor pages which we don't have
// yet. The depth.originality_vs_serp dimension in the existing AI
// scorer already covers this with a qualitative judgment; revisit
// when embeddings are wired across published posts and the SERP.

export interface SeoExtras {
  /** Per-signal verdicts; UI maps to coloured gauges. */
  metaTitle: GaugeSignal;
  metaDescription: GaugeSignal;
  lengthVsSerp: GaugeSignal;
  imageAlts: GaugeSignal;
  internalLinks: GaugeSignal;
  externalAuthority: GaugeSignal;
  jsonLd: GaugeSignal;
}

export type GaugeStatus = "good" | "warn" | "bad" | "skipped";

export interface GaugeSignal {
  status: GaugeStatus;
  /** Single-line human-readable summary for the panel. */
  label: string;
  /** Optional detail surfaced in a tooltip / drawer. */
  detail?: string;
  /** Concrete current value for the gauge bar (e.g. char count). */
  value?: number | null;
  /** Target/ideal value for comparison. */
  target?: { min?: number; max?: number; ideal?: number };
}

export interface SeoExtrasInput {
  seoMetaTitle: string | null;
  seoMetaDescription: string | null;
  bodyMarkdown: string;
  jsonLdBlocks: unknown[];
  /** When SERP context is available, the average competitor word count. */
  serpAvgWordCount: number | null;
  /** When SERP context is available, top result domains for authority comparison. */
  serpTopDomains: string[];
}

const TITLE_MIN = 40;
const TITLE_MAX = 65;
const DESC_MIN = 120;
const DESC_MAX = 160;
const LENGTH_TOLERANCE = 0.2; // ±20%
const MIN_INTERNAL_LINKS = 3;
const MIN_EXTERNAL_AUTHORITY_LINKS = 2;

export function scoreSeoExtras(input: SeoExtrasInput): SeoExtras {
  return {
    metaTitle: gradeMetaTitle(input.seoMetaTitle),
    metaDescription: gradeMetaDescription(input.seoMetaDescription),
    lengthVsSerp: gradeLengthVsSerp(input.bodyMarkdown, input.serpAvgWordCount),
    imageAlts: gradeImageAlts(input.bodyMarkdown),
    internalLinks: gradeInternalLinks(input.bodyMarkdown),
    externalAuthority: gradeExternalAuthority(
      input.bodyMarkdown,
      input.serpTopDomains
    ),
    jsonLd: gradeJsonLd(input.jsonLdBlocks),
  };
}

function gradeMetaTitle(title: string | null): GaugeSignal {
  if (!title) {
    return {
      status: "bad",
      label: "Meta title missing",
      detail: "Set seo_meta_title to control the SERP snippet.",
      value: 0,
      target: { min: TITLE_MIN, max: TITLE_MAX, ideal: 55 },
    };
  }
  const len = title.length;
  if (len < TITLE_MIN) {
    return {
      status: "warn",
      label: `Meta title short (${len} chars)`,
      detail: `Aim for ${TITLE_MIN}-${TITLE_MAX} chars to fill the SERP line without truncating.`,
      value: len,
      target: { min: TITLE_MIN, max: TITLE_MAX, ideal: 55 },
    };
  }
  if (len > TITLE_MAX) {
    return {
      status: "warn",
      label: `Meta title long (${len} chars) — will truncate`,
      detail: `Google typically truncates titles past ${TITLE_MAX} chars.`,
      value: len,
      target: { min: TITLE_MIN, max: TITLE_MAX, ideal: 55 },
    };
  }
  return {
    status: "good",
    label: `Meta title ${len} chars`,
    value: len,
    target: { min: TITLE_MIN, max: TITLE_MAX, ideal: 55 },
  };
}

function gradeMetaDescription(desc: string | null): GaugeSignal {
  if (!desc) {
    return {
      status: "bad",
      label: "Meta description missing",
      detail: "Set seo_meta_description so the SERP snippet isn't auto-generated.",
      value: 0,
      target: { min: DESC_MIN, max: DESC_MAX, ideal: 150 },
    };
  }
  const len = desc.length;
  if (len < DESC_MIN) {
    return {
      status: "warn",
      label: `Meta description short (${len} chars)`,
      value: len,
      target: { min: DESC_MIN, max: DESC_MAX, ideal: 150 },
    };
  }
  if (len > DESC_MAX) {
    return {
      status: "warn",
      label: `Meta description long (${len} chars) — will truncate`,
      value: len,
      target: { min: DESC_MIN, max: DESC_MAX, ideal: 150 },
    };
  }
  return {
    status: "good",
    label: `Meta description ${len} chars`,
    value: len,
    target: { min: DESC_MIN, max: DESC_MAX, ideal: 150 },
  };
}

function countWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, " ") // strip code blocks
    .replace(/`[^`]*`/g, " ") // strip inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // strip image markdown
    .replace(/\[[^\]]*\]\([^)]*\)/g, " $1 ") // unwrap link text
    .replace(/[#>*_~`-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function gradeLengthVsSerp(
  markdown: string,
  serpAvg: number | null
): GaugeSignal {
  const words = countWords(markdown);
  if (serpAvg === null) {
    return {
      status: "skipped",
      label: `${words} words (no SERP target available)`,
      value: words,
    };
  }
  const ratio = words / serpAvg;
  const min = serpAvg * (1 - LENGTH_TOLERANCE);
  const max = serpAvg * (1 + LENGTH_TOLERANCE);
  if (ratio < 1 - LENGTH_TOLERANCE) {
    return {
      status: "warn",
      label: `${words} words — short vs SERP avg ${Math.round(serpAvg)}`,
      detail: `Target ±20% of competitor average.`,
      value: words,
      target: { min: Math.round(min), max: Math.round(max), ideal: Math.round(serpAvg) },
    };
  }
  if (ratio > 1 + LENGTH_TOLERANCE) {
    return {
      status: "warn",
      label: `${words} words — long vs SERP avg ${Math.round(serpAvg)}`,
      detail: `Verify the extra length adds depth, not filler.`,
      value: words,
      target: { min: Math.round(min), max: Math.round(max), ideal: Math.round(serpAvg) },
    };
  }
  return {
    status: "good",
    label: `${words} words (SERP avg ${Math.round(serpAvg)})`,
    value: words,
    target: { min: Math.round(min), max: Math.round(max), ideal: Math.round(serpAvg) },
  };
}

function gradeImageAlts(markdown: string): GaugeSignal {
  // Markdown image syntax: ![alt](url). Empty alt = ![](url).
  const matches = Array.from(markdown.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g));
  if (matches.length === 0) {
    return {
      status: "skipped",
      label: "No images",
    };
  }
  const missing = matches.filter((m) => !m[1].trim()).length;
  if (missing === 0) {
    return {
      status: "good",
      label: `All ${matches.length} images have alt text`,
      value: matches.length - missing,
      target: { ideal: matches.length },
    };
  }
  const ratio = (matches.length - missing) / matches.length;
  return {
    status: ratio >= 0.7 ? "warn" : "bad",
    label: `${missing}/${matches.length} images missing alt text`,
    detail: "Every image needs descriptive alt text for accessibility + image SEO.",
    value: matches.length - missing,
    target: { ideal: matches.length },
  };
}

function gradeInternalLinks(markdown: string): GaugeSignal {
  // Count [text](url) where url is relative or matches the same domain.
  const links = Array.from(markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g))
    .map((m) => m[1])
    .filter((url) => !url.startsWith("#") && !url.startsWith("mailto:"));
  const internal = links.filter(
    (url) => url.startsWith("/") || /^https?:\/\/(www\.)?gruve\.events/.test(url)
  ).length;
  if (internal >= MIN_INTERNAL_LINKS) {
    return {
      status: "good",
      label: `${internal} internal links`,
      value: internal,
      target: { min: MIN_INTERNAL_LINKS, ideal: 5 },
    };
  }
  return {
    status: internal === 0 ? "bad" : "warn",
    label: `${internal} internal links (target ${MIN_INTERNAL_LINKS}+)`,
    detail: "Internal links spread authority and keep readers on-site.",
    value: internal,
    target: { min: MIN_INTERNAL_LINKS, ideal: 5 },
  };
}

function gradeExternalAuthority(
  markdown: string,
  serpTopDomains: string[]
): GaugeSignal {
  const externalUrls = Array.from(markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g))
    .map((m) => m[1])
    .filter((url) => /^https?:\/\//.test(url))
    .filter((url) => !/gruve\.events/.test(url));
  if (externalUrls.length === 0) {
    return {
      status: "warn",
      label: "No outbound links",
      detail: "≥2 outbound links to authoritative sources strengthens E-E-A-T.",
      value: 0,
      target: { min: MIN_EXTERNAL_AUTHORITY_LINKS, ideal: 3 },
    };
  }
  // We don't have DR data; proxy "authority" by matching domains present
  // in the SERP top-10 (a domain that ranks for the keyword is at least
  // contextually authoritative for it).
  const authoritative = serpTopDomains.length
    ? externalUrls.filter((url) => {
        try {
          const host = new URL(url).hostname.replace(/^www\./, "");
          return serpTopDomains.some((d) => host.endsWith(d));
        } catch {
          return false;
        }
      }).length
    : externalUrls.length;
  if (authoritative >= MIN_EXTERNAL_AUTHORITY_LINKS) {
    return {
      status: "good",
      label: `${authoritative} authoritative outbound links`,
      value: authoritative,
      target: { min: MIN_EXTERNAL_AUTHORITY_LINKS, ideal: 3 },
    };
  }
  return {
    status: "warn",
    label: `${externalUrls.length} outbound, ${authoritative} authoritative`,
    detail: serpTopDomains.length
      ? "Authoritative = domain also ranks in the SERP top 10."
      : "SERP context unavailable; counting all outbound as proxy.",
    value: authoritative,
    target: { min: MIN_EXTERNAL_AUTHORITY_LINKS, ideal: 3 },
  };
}

function gradeJsonLd(blocks: unknown[]): GaugeSignal {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      status: "warn",
      label: "No structured data",
      detail: "Add at least Article + BreadcrumbList schema.",
      value: 0,
      target: { min: 1, ideal: 2 },
    };
  }
  const types = blocks
    .map((b) => {
      if (b && typeof b === "object" && "@type" in b) {
        const t = (b as { "@type": unknown })["@type"];
        return typeof t === "string" ? t : null;
      }
      return null;
    })
    .filter((t): t is string => !!t);
  const hasArticle = types.some((t) => t === "Article" || t === "BlogPosting");
  if (!hasArticle) {
    return {
      status: "warn",
      label: `${blocks.length} JSON-LD blocks (no Article)`,
      detail: "Include Article or BlogPosting as the base schema.",
      value: blocks.length,
      target: { min: 1, ideal: 2 },
    };
  }
  return {
    status: "good",
    label: `${blocks.length} JSON-LD block${blocks.length === 1 ? "" : "s"}: ${types.join(", ")}`,
    value: blocks.length,
    target: { min: 1, ideal: 2 },
  };
}
