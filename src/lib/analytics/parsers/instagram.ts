import type { ExtractedFile } from "../zip-extractor";

export interface InstagramPost {
  timestamp: Date;
  caption: string;
  mediaType: "photo" | "video" | "reel" | "story";
  permalink: string | null;
  likes: number | null;
}

function findFile(files: ExtractedFile[], ...fragments: string[]): ExtractedFile | undefined {
  return files.find((f) =>
    fragments.some((frag) => f.path.toLowerCase().includes(frag.toLowerCase()))
  );
}

function parsePostsJson(text: string, mediaType: InstagramPost["mediaType"]): InstagramPost[] {
  try {
    const raw = JSON.parse(text);
    const arr = Array.isArray(raw) ? raw : [];
    return arr.flatMap((item: Record<string, unknown>) => {
      const mediaArr = Array.isArray(item.media) ? (item.media as Record<string, unknown>[]) : [item];
      return mediaArr.map((m) => {
        const ts = typeof m.creation_timestamp === "number"
          ? new Date(m.creation_timestamp * 1000)
          : new Date();
        const caption = typeof m.title === "string" ? m.title :
          typeof item.title === "string" ? item.title : "";
        return { timestamp: ts, caption, mediaType, permalink: null, likes: null };
      });
    });
  } catch { return []; }
}

export function parseInstagramZip(files: ExtractedFile[]): InstagramPost[] {
  const posts: InstagramPost[] = [];

  const postFiles = files.filter((f) =>
    /your_instagram_activity.content.posts_\d+\.json/i.test(f.path) ||
    /content.posts_\d+\.json/i.test(f.path)
  );
  for (const f of postFiles) posts.push(...parsePostsJson(f.text, "photo"));

  const reelsFile = findFile(files, "reels.json");
  if (reelsFile) {
    try {
      const raw = JSON.parse(reelsFile.text);
      const arr = raw?.media_map_by_media_type?.["12"] ?? [];
      const reels = Array.isArray(arr) ? arr : [];
      for (const r of reels as Record<string, unknown>[]) {
        const ts = typeof r.creation_timestamp === "number"
          ? new Date(r.creation_timestamp * 1000) : new Date();
        posts.push({ timestamp: ts, caption: String(r.title ?? ""), mediaType: "reel", permalink: null, likes: null });
      }
    } catch { /* fallback */ }
    if (posts.filter((p) => p.mediaType === "reel").length === 0) {
      posts.push(...parsePostsJson(reelsFile.text, "reel"));
    }
  }

  const storiesFile = findFile(files, "stories.json");
  if (storiesFile) posts.push(...parsePostsJson(storiesFile.text, "story"));

  return posts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
