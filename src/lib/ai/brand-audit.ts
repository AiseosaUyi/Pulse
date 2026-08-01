// Brand audit — the 60-second onboarding hero.
//
// Given a website URL, fetch a small sample of the site's public
// content, feed it to gpt-4.1, and return a populated BrandVoice +
// BrandPositioning pair. This replaces the manual "fill out 15 fields
// before AI works" onboarding that kills activation.
//
// Keeps the scrape small (~5KB of stripped text per page, up to 3
// pages) so we stay under the 60s Vercel function cap comfortably —
// fetch + strip + one AI call totals ~15-25s in practice.

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModel, getModelId, estimateCostUsd, logAiCall } from "@/lib/ai/gateway";
import { brandVoiceSchema, type BrandVoice } from "@/lib/ai/brand-voice";
import {
  brandPositioningSchema,
  type BrandPositioning,
} from "@/lib/ai/brand-positioning";

/** Paths we probe in addition to the homepage. First hit wins per path. */
const SECONDARY_PATHS = ["/about", "/about-us", "/services", "/what-we-do"];

export interface ScrapedSite {
  url: string;
  title: string;
  description: string;
  sampleText: string;
  pagesFetched: string[];
}

/**
 * Fetch the homepage + a couple "about"-style pages, strip HTML, and
 * return a compact text sample for the AI extractor.
 *
 * Intentionally tolerant: any secondary page failing is fine — we
 * only need the homepage to proceed. A complete fetch failure on the
 * homepage is a hard error so the caller can surface it.
 */
export async function scrapeSite(rawUrl: string): Promise<ScrapedSite> {
  const base = normalizeUrl(rawUrl);
  const homepage = await fetchAndStrip(base);
  if (!homepage) {
    throw new Error(
      `Could not fetch ${base}. Check the URL and that the site is publicly reachable.`
    );
  }

  const pages: Array<{ url: string; text: string }> = [
    { url: base, text: homepage.text },
  ];

  for (const path of SECONDARY_PATHS) {
    const probe = await fetchAndStrip(new URL(path, base).toString());
    if (probe) {
      pages.push({ url: new URL(path, base).toString(), text: probe.text });
      if (pages.length >= 3) break;
    }
  }

  const combined = pages
    .map((p) => `# Page: ${p.url}\n${p.text}`)
    .join("\n\n---\n\n");

  // Cap final sample at ~12KB so token count stays reasonable.
  const sampleText = combined.slice(0, 12_000);

  return {
    url: base,
    title: homepage.title,
    description: homepage.description,
    sampleText,
    pagesFetched: pages.map((p) => p.url),
  };
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `https://${trimmed.replace(/^\/+/, "").replace(/\/$/, "")}`;
}

async function fetchAndStrip(url: string): Promise<
  | {
      text: string;
      title: string;
      description: string;
    }
  | null
> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "PulseBrandAudit/1.0 (+https://pulse-ashy-kappa.vercel.app)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return {
      title: pickMeta(html, "title"),
      description: pickMeta(html, "description"),
      text: stripHtml(html).slice(0, 5000),
    };
  } catch {
    return null;
  }
}

function pickMeta(html: string, kind: "title" | "description"): string {
  if (kind === "title") {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m?.[1]?.trim() ?? "";
  }
  const m =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    ) ??
    html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
    );
  return m?.[1]?.trim() ?? "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ──────────────────────────────────────────────────────────
// AI extraction
// ──────────────────────────────────────────────────────────

const auditOutputSchema = z.object({
  voice: brandVoiceSchema,
  positioning: brandPositioningSchema,
  summary: z
    .string()
    .min(1)
    .max(600)
    .describe(
      "A 1-2 sentence friendly summary of what this brand does, shown to the user on the onboarding success screen."
    ),
});

export interface BrandAuditResult {
  voice: BrandVoice;
  positioning: BrandPositioning;
  summary: string;
  cost: number;
  durationMs: number;
  pagesFetched: string[];
}

export async function runBrandAuditAi(
  tenantSlug: string,
  site: ScrapedSite
): Promise<BrandAuditResult> {
  const system = [
    "You are a senior brand strategist. Given scraped website text, extract the brand's voice and positioning in structured JSON.",
    "",
    "Rules:",
    "- Write in the VOICE of the brand (e.g. 'We help...' not 'This company helps...') where it reads naturally.",
    "- Be concrete. Specific > generic. 'Event organizers in Lagos' beats 'business owners'.",
    "- If the site gives obvious signals (industry, product, target market), use them. Don't invent facts not supported by the text.",
    "- `voice.tone` is 3-5 adjectives (e.g. 'direct, energetic, no-fluff').",
    "- `voice.do_list` / `dont_list` are 3-5 items each — concrete writing rules a copywriter could follow.",
    "- `voice.example_posts` are 2-3 short example sentences matching the extracted tone.",
    "- `positioning.mission` is one sentence (<=200 chars).",
    "- `positioning.value_proposition` is one sentence (<=200 chars).",
    "- `positioning.differentiators` are 3-5 specific strengths vs generic market.",
    "- `positioning.topics_to_cover` is 5-10 editorial themes relevant to the audience.",
    "- `positioning.topics_to_avoid` can be empty if nothing obvious.",
    "- `positioning.target_demographics` has 1-3 segments, each with 2-4 concrete pain_points.",
    "- `positioning.competitors` can be empty — we'll populate these from SERP later. Only include if the site explicitly names competitors or the category is unambiguous.",
    "- `summary` is friendly, first-person plural ('We'), 1-2 sentences.",
    "- Return ONLY JSON matching the schema.",
  ].join("\n");

  const user = [
    `Brand URL: ${site.url}`,
    site.title ? `Homepage <title>: ${site.title}` : null,
    site.description ? `Meta description: ${site.description}` : null,
    "",
    "--- Scraped content sample ---",
    site.sampleText,
    "--- End sample ---",
    "",
    "Extract the brand voice and positioning.",
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  const started = Date.now();
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: auditOutputSchema }),
      system,
      prompt: user,
    });

    const durationMs = Date.now() - started;
    const usage = result.usage;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });

    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "brand_audit",
      model: modelId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd: cost,
      durationMs,
      success: true,
    });

    return {
      voice: result.output.voice,
      positioning: result.output.positioning,
      summary: result.output.summary,
      cost,
      durationMs,
      pagesFetched: site.pagesFetched,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "brand_audit",
      model: modelId,
      durationMs,
      success: false,
      errorMessage: message,
    });
    throw err;
  }
}

// ──────────────────────────────────────────────────────────
// Slice 2: competitor discovery, keyword discovery, starter briefs.
// Each is ONE AI call (<25s) so we can chunk them into a state
// machine and fit the Vercel Hobby 60s cap per advance step.
// ──────────────────────────────────────────────────────────

const competitorDiscoverySchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string().min(1),
        domain: z.string().nullable(),
        why: z
          .string()
          .min(1)
          .describe(
            "One sentence explaining why this is a competitor for this brand."
          ),
      })
    )
    .min(3)
    .max(6),
});

export interface DiscoveredCompetitor {
  name: string;
  domain: string | null;
  why: string;
}

export interface CompetitorDiscoveryResult {
  competitors: DiscoveredCompetitor[];
  cost: number;
  durationMs: number;
}

export async function discoverCompetitorsAi(
  tenantSlug: string,
  positioningBlock: string,
  brandName: string,
  market?: { domain?: string | null; primaryRegions?: string[] }
): Promise<CompetitorDiscoveryResult> {
  const system = [
    "You are a competitive researcher. Given a brand's positioning, name 3-5 REAL direct competitors they would benchmark against.",
    "",
    "Rules:",
    "- Competitors must be real companies that actually exist. If you can't verify 3 real ones, return the most plausible category leaders.",
    "- Competitors MUST operate in and serve the SAME geographic market as this brand (see 'Market' below) — not just the same vertical globally. A well-known global/US brand in the same category is the WRONG answer if it doesn't actually operate in this brand's market. When in doubt, prefer a smaller local/regional player that's actually reachable by this brand's customers over a bigger name that isn't.",
    "- A competitor sells the SAME thing to the SAME kind of buyer this brand sells to. Never list a business that would be a CUSTOMER of this brand (e.g. a bar/restaurant/venue is a customer of a drinks or supplies distributor, not its competitor) — that's a prospect, not a competitor.",
    "- `domain` should be the bare domain (e.g. `hubspot.com`) without protocol. Null only if you genuinely don't know.",
    "- `why` is one concrete sentence — not fluff.",
    "- Return ONLY JSON matching the schema.",
  ].join("\n");

  const marketBlock = [
    "Market (competitors must serve this exact market):",
    market?.domain ? `- Brand's own site: ${market.domain}` : null,
    market?.primaryRegions?.length
      ? `- Primary regions served: ${market.primaryRegions.join(", ")}`
      : null,
  ].filter(Boolean);

  const user = [
    `Brand: ${brandName}`,
    "",
    positioningBlock,
    "",
    ...(marketBlock.length > 1 ? [marketBlock.join("\n"), ""] : []),
    "Name 3-5 competitors this brand would benchmark against.",
  ].join("\n");

  const started = Date.now();
  const model = getModel("scoring");
  const modelId = getModelId("scoring");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: competitorDiscoverySchema }),
      system,
      prompt: user,
    });

    const durationMs = Date.now() - started;
    const usage = result.usage;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });

    await logAiCall({
      tenantSlug,
      purpose: "scoring",
      feature: "brand_audit_competitors",
      model: modelId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd: cost,
      durationMs,
      success: true,
    });

    return {
      competitors: result.output.competitors,
      cost,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    await logAiCall({
      tenantSlug,
      purpose: "scoring",
      feature: "brand_audit_competitors",
      model: modelId,
      durationMs,
      success: false,
      errorMessage: message,
    });
    throw err;
  }
}

// ────────────────

const keywordDiscoverySchema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z.string().min(1),
        intent: z
          .enum(["informational", "commercial", "transactional", "navigational"])
          .describe("Search intent category."),
        difficulty: z.enum(["easy", "medium", "hard"]),
      })
    )
    .min(15)
    .max(25),
});

export interface DiscoveredKeyword {
  keyword: string;
  intent: "informational" | "commercial" | "transactional" | "navigational";
  difficulty: "easy" | "medium" | "hard";
}

export interface KeywordDiscoveryResult {
  keywords: DiscoveredKeyword[];
  cost: number;
  durationMs: number;
}

export async function discoverKeywordsAi(
  tenantSlug: string,
  positioningBlock: string,
  competitors: DiscoveredCompetitor[]
): Promise<KeywordDiscoveryResult> {
  const system = [
    "You are a senior SEO strategist. Given a brand's positioning and competitor list, propose 15-25 SEO keywords the brand should track.",
    "",
    "Rules:",
    "- Mix long-tail (3-5 word) and mid-tail (1-3 word) keywords — skew toward long-tail.",
    "- Keywords should be what an actual person types into Google, not marketing copy.",
    "- Include at least 3 transactional keywords (buyer intent), 3 commercial (comparison/research), and the rest informational.",
    "- Don't repeat the same phrase with minor word swaps. Each keyword should be distinct.",
    "- Difficulty: easy = long-tail / niche, medium = 1-2 word with some competition, hard = broad high-volume terms.",
    "- Return ONLY JSON matching the schema.",
  ].join("\n");

  const user = [
    positioningBlock,
    "",
    competitors.length > 0
      ? `Competitors to benchmark against:\n${competitors
          .map((c) => `- ${c.name}${c.domain ? ` (${c.domain})` : ""}`)
          .join("\n")}`
      : "(No competitors identified yet — infer from positioning alone.)",
    "",
    "Propose 15-25 SEO keywords this brand should track.",
  ].join("\n");

  const started = Date.now();
  const model = getModel("scoring");
  const modelId = getModelId("scoring");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: keywordDiscoverySchema }),
      system,
      prompt: user,
    });

    const durationMs = Date.now() - started;
    const usage = result.usage;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });

    await logAiCall({
      tenantSlug,
      purpose: "scoring",
      feature: "brand_audit_keywords",
      model: modelId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd: cost,
      durationMs,
      success: true,
    });

    return {
      keywords: result.output.keywords,
      cost,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    await logAiCall({
      tenantSlug,
      purpose: "scoring",
      feature: "brand_audit_keywords",
      model: modelId,
      durationMs,
      success: false,
      errorMessage: message,
    });
    throw err;
  }
}

// ────────────────

const starterBriefsSchema = z.object({
  briefs: z
    .array(
      z.object({
        title: z
          .string()
          .min(1)
          .describe(
            "Punchy working title. Should sound like an actual blog post, not a topic category."
          ),
        platform: z.enum(["blog", "instagram", "tiktok", "twitter", "linkedin"]),
        content_type: z
          .enum(["article", "thread", "post", "video", "carousel"])
          .describe("What form this brief should take."),
        outline: z
          .array(z.string().min(1))
          .min(3)
          .max(7)
          .describe("3-7 bullet-point sections for the content."),
        draft_content: z
          .string()
          .min(40)
          .describe(
            "A 2-4 sentence angle/hook — what makes this post worth reading, from the brand's POV."
          ),
        seo_keywords: z
          .array(z.string())
          .min(1)
          .max(3)
          .describe("1-3 target keywords from the discovered list."),
      })
    )
    .length(5),
});

export interface DiscoveredBrief {
  title: string;
  platform: "blog" | "instagram" | "tiktok" | "twitter" | "linkedin";
  content_type: "article" | "thread" | "post" | "video" | "carousel";
  outline: string[];
  draft_content: string;
  seo_keywords: string[];
}

export interface StarterBriefsResult {
  briefs: DiscoveredBrief[];
  cost: number;
  durationMs: number;
}

export async function generateStarterBriefsAi(
  tenantSlug: string,
  voiceBlock: string,
  positioningBlock: string,
  keywords: DiscoveredKeyword[],
  competitors: DiscoveredCompetitor[]
): Promise<StarterBriefsResult> {
  const system = [
    "You draft content briefs for the brand below. Produce EXACTLY 5 briefs — a mix of content types (blog, thread, carousel, short video, LinkedIn post).",
    "",
    voiceBlock,
    "",
    positioningBlock,
    "",
    "Rules:",
    "- Each brief should be something the brand would actually want to publish in their first month.",
    "- Spread across the content_type enum so the user sees variety (at least 3 distinct types).",
    "- Pull target keywords from the list provided — don't invent new ones.",
    "- `draft_content` is the angle/hook, not the finished post. 2-4 sentences.",
    "- If competitors are listed, 1-2 briefs should counter-position or fill gaps they're missing.",
    "- Return ONLY JSON matching the schema (exactly 5 briefs).",
  ].join("\n");

  const user = [
    "Available SEO keywords (pick 1-3 per brief):",
    keywords.slice(0, 20).map((k) => `- ${k.keyword} (${k.intent})`).join("\n"),
    "",
    competitors.length > 0
      ? `Competitors we're benchmarking against:\n${competitors
          .map((c) => `- ${c.name}: ${c.why}`)
          .join("\n")}`
      : "(No competitors listed.)",
    "",
    "Draft 5 starter content briefs.",
  ].join("\n");

  const started = Date.now();
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: starterBriefsSchema }),
      system,
      prompt: user,
    });

    const durationMs = Date.now() - started;
    const usage = result.usage;
    const cost = estimateCostUsd(modelId, {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });

    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "brand_audit_briefs",
      model: modelId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd: cost,
      durationMs,
      success: true,
    });

    return {
      briefs: result.output.briefs,
      cost,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    await logAiCall({
      tenantSlug,
      purpose: "synthesis",
      feature: "brand_audit_briefs",
      model: modelId,
      durationMs,
      success: false,
      errorMessage: message,
    });
    throw err;
  }
}
