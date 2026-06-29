// AI-powered parser for social media data exports (JSON / HTML).
// TikTok and Instagram "Download your data" archives produce JSON or HTML
// files whose schemas change without notice. This module tries rule-based
// extraction for known structures first, then falls back to a small AI call
// to interpret whatever the file actually contains.
//
// Returns the same ParsedCsvRow[] shape as csv-maps.ts so the same DB insert
// path can be reused downstream.

import { generateText, Output } from "ai";
import { z } from "zod";
import { estimateCostUsd, getModel, getModelId, logAiCall } from "@/lib/ai/gateway";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";
import type { ParsedCsvRow, CsvParseResult } from "@/lib/ai/csv-maps";

// ─── constants ────────────────────────────────────────────────────────────────

const MAX_AI_CHARS = 28_000; // ~7 k tokens — keeps cost < $0.02
const MAX_POSTS = 200;       // cap rows returned
const PURPOSE = "analysis" as const;
const MODEL_ID = getModelId(PURPOSE);

// ─── Zod schema for AI output ─────────────────────────────────────────────────

const postSchema = z.object({
  title: z.string().nullable(),
  caption: z.string().nullable(),
  external_url: z.string().nullable(),
  posted_at: z.string().nullable(),
  views: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  shares: z.number().nullable(),
  saves: z.number().nullable(),
  reach: z.number().nullable(),
  impressions: z.number().nullable(),
  engagement_rate: z.number().nullable(),
});

const exportSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "twitter", "linkedin"]).nullable(),
  posts: z.array(postSchema),
});

type ExportSchema = z.infer<typeof exportSchema>;

// ─── Rule-based extractors for known export formats ───────────────────────────

function tryTikTokJson(obj: unknown): ParsedCsvRow[] | null {
  // TikTok "Download your data" → user_data.json
  // Shape: { "Video": { "Videos": [ { Date, Likes, Comments, Shares, Link } ] } }
  const root = obj as Record<string, unknown>;
  const videoSection = root?.["Video"] as Record<string, unknown> | undefined;
  const videos = videoSection?.["Videos"];
  if (!Array.isArray(videos) || videos.length === 0) return null;

  return videos.slice(0, MAX_POSTS).map((v: Record<string, unknown>) => {
    const metrics: ParsedCsvRow["metrics"] = {};
    const toNum = (val: unknown): number | undefined => {
      if (val === undefined || val === null) return undefined;
      const cleaned = String(val).replace(/,/g, "").trim();
      if (cleaned === "") return undefined;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : undefined;
    };
    const likes = toNum(v["Likes"] ?? v["likes"]);
    const comments = toNum(v["Comments"] ?? v["comments"]);
    const shares = toNum(v["Shares"] ?? v["shares"]);
    const views = toNum(v["Views"] ?? v["views"] ?? v["Video views"]);
    if (likes !== undefined) metrics.likes = likes;
    if (comments !== undefined) metrics.comments = comments;
    if (shares !== undefined) metrics.shares = shares;
    if (views !== undefined) metrics.views = views;

    return {
      metrics,
      caption: String(v["Description"] ?? v["description"] ?? "").trim() || undefined,
      externalUrl: String(v["Link"] ?? v["link"] ?? "").trim() || undefined,
      postedAt: String(v["Date"] ?? v["date"] ?? "").trim() || undefined,
    };
  });
}

function tryInstagramPostsJson(obj: unknown): ParsedCsvRow[] | null {
  // Instagram "Download your information" → content/posts_1.json
  // Shape: [ { media: [ { uri, creation_timestamp, title } ] } ]
  if (!Array.isArray(obj)) return null;
  const first = obj[0];
  if (!first || typeof first !== "object") return null;
  if (!Array.isArray((first as Record<string, unknown>)?.["media"])) return null;

  return (obj as Array<Record<string, unknown>>)
    .slice(0, MAX_POSTS)
    .flatMap((post) => {
      const media = post["media"] as Array<Record<string, unknown>>;
      return media.slice(0, 1).map((m) => ({
        metrics: {} as ParsedCsvRow["metrics"],
        caption: String(post["title"] ?? m["title"] ?? "").trim() || undefined,
        postedAt: m["creation_timestamp"]
          ? new Date(Number(m["creation_timestamp"]) * 1000).toISOString()
          : undefined,
      }));
    });
}

function stripHtml(html: string): string {
  // Remove scripts/styles, then strip tags, collapse whitespace.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── AI fallback ──────────────────────────────────────────────────────────────

async function extractWithAi(
  tenantSlug: string,
  content: string,
  fileType: "json" | "html",
  platformHint: OwnMetricsPlatform | null
): Promise<ExportSchema> {
  const started = Date.now();
  const truncated =
    content.length > MAX_AI_CHARS
      ? content.slice(0, MAX_AI_CHARS) + "\n…[truncated]"
      : content;

  const platformLine = platformHint
    ? `The user says this is a ${platformHint} export.`
    : "Infer the platform from the file content.";

  const system = [
    `You extract social media post metrics from a ${fileType.toUpperCase()} data export file.`,
    platformLine,
    "Return every post/video you find with its numeric metrics.",
    "Omit posts with zero metrics (no numbers at all).",
    "For any field you cannot find, return null.",
    "engagement_rate must be a decimal percentage (e.g. 12.5 means 12.5%), not a fraction.",
    "posted_at must be an ISO date string if a date is present, else null.",
    `Return at most ${MAX_POSTS} posts.`,
  ].join("\n");

  try {
    const result = await generateText({
      model: getModel(PURPOSE),
      output: Output.object({ schema: exportSchema }),
      system,
      messages: [
        {
          role: "user",
          content: `Here is the ${fileType.toUpperCase()} file content:\n\n${truncated}`,
        },
      ],
    });

    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cost = estimateCostUsd(MODEL_ID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    });

    await logAiCall({
      tenantSlug,
      purpose: PURPOSE,
      feature: "data_export_parse",
      model: MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
      durationMs: Date.now() - started,
      success: true,
    });

    return result.output;
  } catch (err) {
    await logAiCall({
      tenantSlug,
      purpose: PURPOSE,
      feature: "data_export_parse",
      model: MODEL_ID,
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ─── schema output → ParsedCsvRow[] ──────────────────────────────────────────

function aiResultToRows(result: ExportSchema): ParsedCsvRow[] {
  return result.posts.map((p) => {
    const metrics: ParsedCsvRow["metrics"] = {};
    if (p.views !== null && p.views !== undefined) metrics.views = p.views;
    if (p.likes !== null && p.likes !== undefined) metrics.likes = p.likes;
    if (p.comments !== null && p.comments !== undefined) metrics.comments = p.comments;
    if (p.shares !== null && p.shares !== undefined) metrics.shares = p.shares;
    if (p.saves !== null && p.saves !== undefined) metrics.saves = p.saves;
    if (p.reach !== null && p.reach !== undefined) metrics.reach = p.reach;
    if (p.impressions !== null && p.impressions !== undefined) metrics.impressions = p.impressions;
    if (p.engagement_rate !== null && p.engagement_rate !== undefined)
      metrics.engagement_rate = p.engagement_rate;
    return {
      metrics,
      title: p.title ?? undefined,
      caption: p.caption ?? undefined,
      externalUrl: p.external_url ?? undefined,
      postedAt: p.posted_at ?? undefined,
    };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DataExportParseResult extends CsvParseResult {
  detectedPlatform: OwnMetricsPlatform | null;
  method: "rule-based" | "ai";
}

export async function parseDataExport({
  tenantSlug,
  content,
  fileType,
  platformHint,
}: {
  tenantSlug: string;
  content: string;
  fileType: "json" | "html";
  platformHint: OwnMetricsPlatform | null;
}): Promise<DataExportParseResult> {
  // 1. Rule-based for known JSON formats (free, instant)
  if (fileType === "json") {
    try {
      const obj = JSON.parse(content);

      const tiktokRows = tryTikTokJson(obj);
      if (tiktokRows && tiktokRows.length > 0) {
        return {
          rows: tiktokRows.filter((r) => Object.keys(r.metrics).length > 0),
          unrecognizedHeaders: [],
          detectedPlatform: "tiktok",
          method: "rule-based",
        };
      }

      const igRows = tryInstagramPostsJson(obj);
      if (igRows && igRows.length > 0) {
        return {
          rows: igRows,
          unrecognizedHeaders: [],
          detectedPlatform: "instagram",
          method: "rule-based",
        };
      }
    } catch {
      // Not valid JSON — fall through to AI
    }
  }

  // 2. AI fallback for HTML, non-standard JSON, or when rule-based yields nothing
  const textContent =
    fileType === "html" ? stripHtml(content) : content;

  const aiResult = await extractWithAi(
    tenantSlug,
    textContent,
    fileType,
    platformHint
  );

  const rows = aiResultToRows(aiResult).filter(
    (r) => Object.keys(r.metrics).length > 0
  );

  return {
    rows,
    unrecognizedHeaders: [],
    detectedPlatform: aiResult.platform,
    method: "ai",
  };
}
