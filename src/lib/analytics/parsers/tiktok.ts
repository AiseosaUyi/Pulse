import type { ExtractedFile } from "../zip-extractor";

export interface TikTokPost {
  timestamp: Date;
  link: string | null;
  likes: number;
  comments: number | null;
  shares: number | null;
  views: number | null;
}

export function parseTikTokZip(files: ExtractedFile[]): TikTokPost[] {
  const userDataFile = files.find((f) => /user_data\.json$/i.test(f.path));
  if (!userDataFile) return [];

  try {
    const raw = JSON.parse(userDataFile.text);
    const videoList =
      raw?.Video?.Videos?.VideoList ??
      raw?.["Video"]?.["Videos"]?.["VideoList"] ??
      [];
    if (!Array.isArray(videoList)) return [];

    return videoList
      .map((v: Record<string, unknown>) => ({
        timestamp: new Date(String(v.Date ?? "")),
        link: typeof v.Link === "string" ? v.Link : null,
        likes: Number(v.Likes ?? v.DiggCount ?? 0),
        comments: v.Comments !== undefined ? Number(v.Comments) : null,
        shares: v.Shares !== undefined ? Number(v.Shares) : null,
        views: v.VideoViews !== undefined ? Number(v.VideoViews) : null,
      }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch { return []; }
}
