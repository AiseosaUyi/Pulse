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
