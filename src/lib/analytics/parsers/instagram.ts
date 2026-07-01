import type { ExtractedFile } from "../zip-extractor";

export interface InstagramPost {
  timestamp: Date;
  caption: string;
  mediaType: "photo" | "video" | "reel" | "story";
  permalink: string | null;
  likes: number | null;
  impressions: number | null;
  reach: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

// ── utilities ─────────────────────────────────────────────────────────────────

function safeDate(ts: number): Date {
  return new Date(ts > 1e10 ? ts : ts * 1000);
}

function numVal(v: string | undefined | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ── Shape D / string_map_data helpers ────────────────────────────────────────

function getTimestampFromStringMap(obj: Record<string, unknown>): number | null {
  const smd = obj.string_map_data as Record<string, { timestamp?: number }> | undefined;
  if (!smd) return null;
  for (const v of Object.values(smd)) {
    if (typeof v.timestamp === "number" && v.timestamp > 0) return v.timestamp;
  }
  return null;
}

function getStringMapValue(obj: Record<string, unknown>, ...keys: string[]): string {
  const smd = obj.string_map_data as Record<string, { value?: string }> | undefined;
  if (!smd) return "";
  for (const key of keys) {
    const entry = smd[key];
    if (entry?.value) return entry.value;
  }
  return "";
}

// ── Media-post JSON shapes (posts_1.json / media/posts.json) ──────────────────
//
// Shape A (common): [{ media: [{ creation_timestamp, title }] }]
// Shape B (flat):   [{ creation_timestamp, title }]
// Shape C (reels):  { media_map_by_media_type: { "2": [...] } }
// Shape D (old):    [{ string_map_data: { "Caption": { value }, ... } }]

function parseItem(
  item: Record<string, unknown>,
  mediaType: InstagramPost["mediaType"]
): InstagramPost | null {
  // Shape A
  if (Array.isArray(item.media) && item.media.length > 0) {
    const m = item.media[0] as Record<string, unknown>;
    const ts =
      typeof m.creation_timestamp === "number"
        ? m.creation_timestamp
        : typeof item.creation_timestamp === "number"
        ? item.creation_timestamp
        : null;
    if (!ts) return null;
    const caption =
      typeof m.title === "string" ? m.title : typeof item.title === "string" ? item.title : "";
    return { timestamp: safeDate(ts), caption, mediaType, permalink: null, likes: null, impressions: null, reach: null, comments: null, shares: null, saves: null };
  }

  // Shape D
  if (item.string_map_data && typeof item.string_map_data === "object") {
    const ts = getTimestampFromStringMap(item);
    if (!ts) return null;
    const caption = getStringMapValue(item, "Description", "Caption", "Text", "Post Description");
    return { timestamp: safeDate(ts), caption, mediaType, permalink: null, likes: null, impressions: null, reach: null, comments: null, shares: null, saves: null };
  }

  // Shape B
  if (typeof item.creation_timestamp === "number") {
    return {
      timestamp: safeDate(item.creation_timestamp),
      caption: typeof item.title === "string" ? item.title : "",
      mediaType, permalink: null, likes: null, impressions: null, reach: null, comments: null, shares: null, saves: null,
    };
  }

  return null;
}

function parseArray(arr: unknown[], mediaType: InstagramPost["mediaType"]): InstagramPost[] {
  const out: InstagramPost[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const p = parseItem(item as Record<string, unknown>, mediaType);
    if (p) out.push(p);
  }
  return out;
}

function parseMediaJson(text: string, mediaType: InstagramPost["mediaType"]): InstagramPost[] {
  try {
    const raw: unknown = JSON.parse(text);

    if (Array.isArray(raw)) return parseArray(raw, mediaType);

    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      // Shape C reels wrapper
      const mmt = obj.media_map_by_media_type;
      if (mmt && typeof mmt === "object") {
        const map = mmt as Record<string, unknown>;
        for (const items of Object.values(map)) {
          if (Array.isArray(items) && items.length > 0) return parseArray(items, mediaType);
        }
      }
    }
  } catch { /* malformed */ }
  return [];
}

// ── Insights JSON (logged_information/past_instagram_insights/posts.json) ─────
//
// Format: { organic_insights_posts: [{ string_map_data: { "Impressions": { value }, ... }, media_map_data }] }
// Contains real analytics: impressions, reach, likes, comments, shares, saves, follows.

function parseInsightsJson(text: string): InstagramPost[] {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const posts = raw?.organic_insights_posts;
    if (!Array.isArray(posts)) return [];

    const out: InstagramPost[] = [];
    for (const item of posts) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const smd = obj.string_map_data as Record<string, { value?: string; timestamp?: number }> | undefined;
      if (!smd) continue;

      const ts = smd["Creation timestamp"]?.timestamp;
      if (!ts || ts === 0) continue;

      // Caption from media_map_data (first entry's title field)
      let caption = "";
      const mmd = obj.media_map_data as Record<string, { title?: string }> | undefined;
      if (mmd) {
        const first = Object.values(mmd)[0];
        if (first?.title) caption = first.title;
      }

      out.push({
        timestamp: safeDate(ts),
        caption,
        mediaType: "photo",
        permalink: null,
        likes: numVal(smd["Likes"]?.value),
        impressions: numVal(smd["Impressions"]?.value),
        reach: numVal(smd["Accounts reached"]?.value),
        comments: numVal(smd["Comments"]?.value),
        shares: numVal(smd["Shares"]?.value),
        saves: numVal(smd["Saves"]?.value),
      });
    }
    return out;
  } catch { return []; }
}

// ── fallback: scan any JSON file for Instagram-shaped content ─────────────────

function looksLikeInstagramPosts(text: string): boolean {
  return (
    text.includes("creation_timestamp") ||
    text.includes("string_map_data") ||
    text.includes("media_map_by_media_type") ||
    text.includes("organic_insights_posts")
  );
}

function tryParseAnyJson(files: ExtractedFile[]): InstagramPost[] {
  const out: InstagramPost[] = [];
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith(".json")) continue;
    if (!looksLikeInstagramPosts(f.text)) continue;
    // Try insights format first
    const insights = parseInsightsJson(f.text);
    if (insights.length > 0) { out.push(...insights); continue; }
    // Fall back to media format
    out.push(...parseMediaJson(f.text, "photo"));
  }
  return out;
}

// ── public API ────────────────────────────────────────────────────────────────

export function parseInstagramZip(files: ExtractedFile[]): InstagramPost[] {
  const posts: InstagramPost[] = [];
  const seen = new Set<string>();

  const add = (items: InstagramPost[]) => {
    for (const p of items) {
      const key = `${p.timestamp.getTime()}-${p.caption.slice(0, 30)}`;
      if (!seen.has(key)) { seen.add(key); posts.push(p); }
    }
  };

  // ── 1. Insights file (best: has real engagement metrics) ──────────────────
  const insightFiles = files.filter((f) =>
    /past_instagram_insights[/\\]posts\.json$/i.test(f.path)
  );
  for (const f of insightFiles) add(parseInsightsJson(f.text));

  // ── 2. Canonical media posts (posts_1.json, posts.json, reels.json, etc.) ─
  const postFiles = files.filter((f) => /posts_?\d*\.json$/i.test(f.path) && !insightFiles.includes(f));
  for (const f of postFiles) add(parseMediaJson(f.text, "photo"));

  const archivedFiles = files.filter((f) => /archived_posts\.json$/i.test(f.path));
  for (const f of archivedFiles) add(parseMediaJson(f.text, "photo"));

  const reelFiles = files.filter((f) => /reels(?:_media)?\.json$/i.test(f.path));
  for (const f of reelFiles) add(parseMediaJson(f.text, "reel"));

  const storyFiles = files.filter((f) => /stories\.json$/i.test(f.path));
  for (const f of storyFiles) add(parseMediaJson(f.text, "story"));

  // ── 3. Fallback: scan all JSON files ─────────────────────────────────────
  if (posts.length === 0) add(tryParseAnyJson(files));

  return posts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
