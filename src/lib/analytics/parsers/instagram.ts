import type { ExtractedFile } from "../zip-extractor";

export interface InstagramPost {
  timestamp: Date;
  caption: string;
  mediaType: "photo" | "video" | "reel" | "story";
  permalink: string | null;
  likes: number | null;
}

// ── path matching ──────────────────────────────────────────────────────────────
// Instagram exports can unzip to one of several root layouts:
//   your_instagram_activity/content/posts_1.json          (2023-2025 format)
//   content/posts_1.json                                  (some older exports)
//   media/posts/Post/posts_1.json                         (rare)
// We match any path that ends with posts_N.json, reels.json, stories.json.

function matchesPath(path: string, ...fragments: string[]): boolean {
  const p = path.toLowerCase().replace(/\\/g, "/");
  return fragments.some((f) => p.includes(f.toLowerCase()));
}

function findFiles(files: ExtractedFile[], ...fragments: string[]): ExtractedFile[] {
  return files.filter((f) => fragments.some((frag) => matchesPath(f.path, frag)));
}

// ── JSON field extraction ──────────────────────────────────────────────────────
// Instagram uses a deeply nested structure with "string_map_data" for text values.
// Field names like "Post Created Date" vary by locale — we check common keys.

function getStringMapValue(obj: Record<string, unknown>, ...keys: string[]): string {
  const smd = obj.string_map_data as Record<string, { value?: string; timestamp?: number }> | undefined;
  if (!smd) return "";
  for (const key of keys) {
    const entry = smd[key];
    if (entry?.value) return entry.value;
  }
  return "";
}

function getTimestampFromStringMap(obj: Record<string, unknown>): number | null {
  const smd = obj.string_map_data as Record<string, { timestamp?: number }> | undefined;
  if (!smd) return null;
  for (const v of Object.values(smd)) {
    if (typeof v.timestamp === "number" && v.timestamp > 0) return v.timestamp;
  }
  return null;
}

function safeDate(ts: number): Date {
  // Instagram timestamps are Unix seconds
  return new Date(ts > 1e10 ? ts : ts * 1000);
}

// ── parse a posts/stories/reels JSON file ─────────────────────────────────────
//
// Observed shapes (all real exports, 2022-2025):
//
// Shape A — post-centric array (most common for posts_N.json):
//   [ { media: [ { uri, creation_timestamp, title, ...} ], title } ]
//
// Shape B — flat media array (common for stories.json, archived_posts.json):
//   [ { uri, creation_timestamp, title } ]
//
// Shape C — reels wrapper (reels.json):
//   { media_map_by_media_type: { "2": [ ... ] } }
//   OR  [ { media: [ ... ] } ]
//
// Shape D — string_map_data (older locale-dependent exports, 2019-2022):
//   [ { string_map_data: { "Media Created Date": { timestamp }, "Description": { value } } } ]

function parseItem(item: Record<string, unknown>, mediaType: InstagramPost["mediaType"]): InstagramPost | null {
  // Shape A: has a "media" array child
  if (Array.isArray(item.media) && item.media.length > 0) {
    const m = item.media[0] as Record<string, unknown>;
    const ts = typeof m.creation_timestamp === "number" ? m.creation_timestamp
              : typeof item.creation_timestamp === "number" ? item.creation_timestamp
              : null;
    if (!ts) return null;
    const caption = typeof m.title === "string" ? m.title
                  : typeof item.title === "string" ? item.title
                  : "";
    return { timestamp: safeDate(ts), caption, mediaType, permalink: null, likes: null };
  }

  // Shape D: string_map_data format
  if (item.string_map_data && typeof item.string_map_data === "object") {
    const ts = getTimestampFromStringMap(item);
    if (!ts) return null;
    const caption = getStringMapValue(
      item,
      "Description", "Caption", "Text", "Post Description",
      "Media Created Date" // sometimes caption and date share the same smd key
    );
    return { timestamp: safeDate(ts), caption, mediaType, permalink: null, likes: null };
  }

  // Shape B: flat item with creation_timestamp directly
  if (typeof item.creation_timestamp === "number") {
    const caption = typeof item.title === "string" ? item.title : "";
    return { timestamp: safeDate(item.creation_timestamp), caption, mediaType, permalink: null, likes: null };
  }

  return null;
}

function parseArray(arr: unknown[], mediaType: InstagramPost["mediaType"]): InstagramPost[] {
  const out: InstagramPost[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const parsed = parseItem(item as Record<string, unknown>, mediaType);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseJson(text: string, mediaType: InstagramPost["mediaType"]): InstagramPost[] {
  try {
    const raw: unknown = JSON.parse(text);

    // Top-level array (shapes A, B, D)
    if (Array.isArray(raw)) return parseArray(raw, mediaType);

    // Shape C reels wrapper: { media_map_by_media_type: { "2": [...] } }
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const mmt = obj.media_map_by_media_type;
      if (mmt && typeof mmt === "object") {
        const map = mmt as Record<string, unknown>;
        // media type "2" = video/reel, "1" = photo
        for (const key of Object.keys(map)) {
          const items = map[key];
          if (Array.isArray(items)) return parseArray(items, mediaType);
        }
      }
    }
  } catch { /* malformed JSON */ }
  return [];
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

  // ── Posts ── match any file whose path ends in posts_N.json
  const postFiles = files.filter((f) => /posts_\d*\.json$/i.test(f.path));
  for (const f of postFiles) add(parseJson(f.text, "photo"));

  // ── Archived posts
  const archivedFiles = files.filter((f) => /archived_posts\.json$/i.test(f.path));
  for (const f of archivedFiles) add(parseJson(f.text, "photo"));

  // ── Reels
  const reelFiles = files.filter((f) => /reels(?:_media)?\.json$/i.test(f.path));
  for (const f of reelFiles) add(parseJson(f.text, "reel"));

  // ── Stories
  const storyFiles = files.filter((f) => /stories\.json$/i.test(f.path));
  for (const f of storyFiles) add(parseJson(f.text, "story"));

  // ── Liked posts (no timestamp on the like itself but useful signal)
  // Skipping liked_posts.json — those are other people's posts, not yours.

  return posts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
