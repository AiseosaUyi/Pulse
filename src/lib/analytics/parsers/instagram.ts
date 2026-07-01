import type { ExtractedFile } from "../zip-extractor";

export interface InstagramPost {
  timestamp: Date;
  caption: string;
  mediaType: "photo" | "video" | "reel" | "story";
  permalink: string | null;
  likes: number | null;
}

// ── shape detection ───────────────────────────────────────────────────────────

function safeDate(ts: number): Date {
  return new Date(ts > 1e10 ? ts : ts * 1000);
}

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

function parseItem(
  item: Record<string, unknown>,
  mediaType: InstagramPost["mediaType"]
): InstagramPost | null {
  // Shape A: { media: [{ creation_timestamp, title }] }
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
      typeof m.title === "string"
        ? m.title
        : typeof item.title === "string"
        ? item.title
        : "";
    return { timestamp: safeDate(ts), caption, mediaType, permalink: null, likes: null };
  }

  // Shape D: string_map_data (locale-dependent older format)
  if (item.string_map_data && typeof item.string_map_data === "object") {
    const ts = getTimestampFromStringMap(item);
    if (!ts) return null;
    const caption = getStringMapValue(
      item,
      "Description",
      "Caption",
      "Text",
      "Post Description"
    );
    return { timestamp: safeDate(ts), caption, mediaType, permalink: null, likes: null };
  }

  // Shape B: flat { creation_timestamp, title }
  if (typeof item.creation_timestamp === "number") {
    return {
      timestamp: safeDate(item.creation_timestamp),
      caption: typeof item.title === "string" ? item.title : "",
      mediaType,
      permalink: null,
      likes: null,
    };
  }

  return null;
}

function parseArray(
  arr: unknown[],
  mediaType: InstagramPost["mediaType"]
): InstagramPost[] {
  const out: InstagramPost[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const p = parseItem(item as Record<string, unknown>, mediaType);
    if (p) out.push(p);
  }
  return out;
}

function parseJson(
  text: string,
  mediaType: InstagramPost["mediaType"]
): InstagramPost[] {
  try {
    const raw: unknown = JSON.parse(text);

    // Top-level array — shapes A, B, D
    if (Array.isArray(raw)) return parseArray(raw, mediaType);

    // Shape C: reels wrapper { media_map_by_media_type: { "2": [...] } }
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const mmt = obj.media_map_by_media_type;
      if (mmt && typeof mmt === "object") {
        const map = mmt as Record<string, unknown>;
        for (const key of Object.keys(map)) {
          const items = map[key];
          if (Array.isArray(items) && items.length > 0) {
            return parseArray(items, mediaType);
          }
        }
      }
    }
  } catch {
    // malformed JSON
  }
  return [];
}

// ── fallback: scan any JSON file for Instagram-shaped content ─────────────────
// Used when no canonical filename matched — handles renamed folders,
// future format changes, or unexpected ZIP structures.

function looksLikeInstagramPosts(text: string): boolean {
  // Quick heuristic before full parse: check for common Instagram JSON fields
  return (
    text.includes("creation_timestamp") ||
    text.includes("string_map_data") ||
    text.includes("media_map_by_media_type")
  );
}

function tryParseAnyJson(files: ExtractedFile[]): InstagramPost[] {
  const out: InstagramPost[] = [];
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith(".json")) continue;
    if (!looksLikeInstagramPosts(f.text)) continue;
    const parsed = parseJson(f.text, "photo");
    out.push(...parsed);
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
      if (!seen.has(key)) {
        seen.add(key);
        posts.push(p);
      }
    }
  };

  // ── canonical file names ──────────────────────────────────────────────────
  const postFiles = files.filter((f) => /posts_\d*\.json$/i.test(f.path));
  for (const f of postFiles) add(parseJson(f.text, "photo"));

  const archivedFiles = files.filter((f) => /archived_posts\.json$/i.test(f.path));
  for (const f of archivedFiles) add(parseJson(f.text, "photo"));

  const reelFiles = files.filter((f) => /reels(?:_media)?\.json$/i.test(f.path));
  for (const f of reelFiles) add(parseJson(f.text, "reel"));

  const storyFiles = files.filter((f) => /stories\.json$/i.test(f.path));
  for (const f of storyFiles) add(parseJson(f.text, "story"));

  // ── fallback: scan every JSON if canonical approach found nothing ──────────
  if (posts.length === 0) {
    add(tryParseAnyJson(files));
  }

  return posts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
