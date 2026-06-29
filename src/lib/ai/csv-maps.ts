// Per-platform CSV header maps. Platforms change headers 1-2 times per year —
// the parser tolerates unknown columns and logs them so maps can be updated
// without a deploy.

import type { OwnMetricsPayload, OwnMetricsPlatform } from "@/lib/types/own-metrics";

type HeaderMap = Partial<Record<keyof OwnMetricsPayload | "title" | "caption" | "external_url" | "posted_at" | "tweet_id", string[]>>;

export const CSV_MAPS: Record<OwnMetricsPlatform, HeaderMap> = {
  instagram: {
    views: ["Views", "Video views", "Plays", "Play count"],
    likes: ["Likes"],
    comments: ["Comments"],
    shares: ["Shares"],
    saves: ["Saves"],
    reach: ["Reach", "Accounts reached"],
    impressions: ["Impressions"],
    title: ["Post title", "Caption excerpt"],
    caption: ["Caption", "Description"],
    external_url: ["Permalink", "URL"],
    posted_at: ["Publish time", "Date", "Published time"],
  },
  tiktok: {
    views: ["Video views", "Views"],
    likes: ["Likes"],
    comments: ["Comments"],
    shares: ["Shares"],
    reach: ["Reach"],
    impressions: ["Impressions"],
    title: ["Video description", "Title"],
    caption: ["Video description", "Description"],
    external_url: ["Video link", "URL", "Link"],
    posted_at: ["Posting time", "Date", "Published"],
  },
  twitter: {
    views: ["Impressions", "Views"],
    likes: ["Likes", "Favorites"],
    comments: ["Replies"],
    shares: ["Retweets", "Reposts"],
    impressions: ["Impressions"],
    engagement_rate: ["Engagement rate", "Engagement Rate"],
    title: ["Tweet text", "Tweet Text", "Text", "Content"],
    caption: ["Tweet text", "Tweet Text", "Text", "Content"],
    external_url: ["Tweet permalink", "Permalink", "URL", "Link"],
    tweet_id: ["Tweet id", "Tweet ID", "id", "tweet_id"],
    posted_at: ["Time", "Date", "Created at", "Timestamp"],
  },
  linkedin: {
    impressions: ["Impressions", "Impressions (total)"],
    likes: ["Reactions", "Likes", "Reactions (total)"],
    comments: ["Comments", "Comments (total)"],
    shares: ["Reposts", "Shares", "Reposts (total)"],
    engagement_rate: ["Engagement rate", "Engagement rate (%)"],
    title: ["Post title"],
    caption: ["Post content", "Update"],
    external_url: ["Post URL", "URL"],
    posted_at: ["Created time", "Publish time", "Date"],
  },
};

export interface ParsedCsvRow {
  metrics: OwnMetricsPayload;
  title?: string;
  caption?: string;
  externalUrl?: string;
  postedAt?: string;
  tweetId?: string;
}

export interface CsvParseResult {
  rows: ParsedCsvRow[];
  unrecognizedHeaders: string[];
}

function parseNumber(v: string): number | undefined {
  const cleaned = v.replace(/[,%]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

// Minimal CSV parser: handles quoted fields with escaped quotes, commas inside
// quotes, and trailing newlines. Rejects malformed input by returning what it
// can parse; caller gets a row count for sanity check.
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        cells.push(cur);
        cur = "";
      } else if (c === '"') {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  cells.push(cur);
  return cells;
}

export function parseCsv(
  platform: OwnMetricsPlatform,
  text: string
): CsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return { rows: [], unrecognizedHeaders: [] };

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const map = CSV_MAPS[platform];

  const headerToField: Array<{ field: string; kind: "metric" | "meta" } | null> =
    headers.map((h) => {
      for (const [field, aliases] of Object.entries(map)) {
        if (aliases?.some((a) => a.toLowerCase() === h.toLowerCase())) {
          const isMeta =
            field === "title" ||
            field === "caption" ||
            field === "external_url" ||
            field === "posted_at" ||
            field === "tweet_id";
          return { field, kind: isMeta ? "meta" : "metric" };
        }
      }
      return null;
    });

  const unrecognizedHeaders: string[] = [];
  headers.forEach((h, i) => {
    if (!headerToField[i]) unrecognizedHeaders.push(h);
  });

  const rows: ParsedCsvRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r]);
    if (cells.length === 0) continue;
    const row: ParsedCsvRow = { metrics: {} };
    cells.forEach((cell, i) => {
      const mapping = headerToField[i];
      if (!mapping) return;
      const clean = cell.trim().replace(/^"|"$/g, "");
      if (mapping.kind === "metric") {
        const num = parseNumber(clean);
        if (num !== undefined) {
          (row.metrics as Record<string, number>)[mapping.field] = num;
        }
      } else {
        if (mapping.field === "title") row.title = clean || undefined;
        else if (mapping.field === "caption") row.caption = clean || undefined;
        else if (mapping.field === "external_url") row.externalUrl = clean || undefined;
        else if (mapping.field === "posted_at") row.postedAt = clean || undefined;
        else if (mapping.field === "tweet_id") row.tweetId = clean || undefined;
      }
    });
    // Construct tweet permalink from id when no explicit permalink was exported
    if (platform === "twitter" && !row.externalUrl && row.tweetId) {
      row.externalUrl = `https://x.com/i/web/status/${row.tweetId}`;
    }
    rows.push(row);
  }

  return { rows, unrecognizedHeaders };
}
