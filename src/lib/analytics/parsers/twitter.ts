import type { ExtractedFile } from "../zip-extractor";

export interface TwitterPost {
  id: string;
  timestamp: Date;
  text: string;
  permalink: string | null;
  impressions: number | null;
  engagements: number | null;
  likes: number;
  retweets: number;
  replies: number;
  bookmarks: number | null;
  profileClicks: number | null;
  videoViews: number | null;
}

function parseTweetJs(text: string): TwitterPost[] {
  // tweet.js is window.YTD.tweet.part0 = [...], strip the assignment
  const jsonStart = text.indexOf("[");
  if (jsonStart === -1) return [];
  try {
    const arr = JSON.parse(text.slice(jsonStart, text.lastIndexOf("]") + 1)) as Array<Record<string, unknown>>;
    return arr.map((item) => {
      const t = (item.tweet as Record<string, unknown>) ?? item;
      const created = String(t.created_at ?? "");
      return {
        id: String(t.id ?? t.id_str ?? ""),
        timestamp: created ? new Date(created) : new Date(),
        text: String(t.full_text ?? t.text ?? ""),
        permalink: t.id ? `https://x.com/i/web/status/${t.id}` : null,
        impressions: null,
        engagements: null,
        likes: Number(t.favorite_count ?? 0),
        retweets: Number(t.retweet_count ?? 0),
        replies: Number(t.reply_count ?? 0),
        bookmarks: null,
        profileClicks: null,
        videoViews: null,
      };
    });
  } catch { return []; }
}

function parseTweetCsv(text: string): TwitterPost[] {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx = (name: string) => headers.indexOf(name);

  const col = {
    id: idx("tweet_id"),
    permalink: idx("tweet_permalink"),
    text: idx("tweet_text"),
    time: idx("time"),
    impressions: idx("impressions"),
    engagements: idx("engagements"),
    likes: idx("likes"),
    retweets: idx("retweets"),
    replies: idx("replies"),
    videoViews: idx("video_views"),
    profileClicks: idx("user_profile_clicks"),
    bookmarks: idx("bookmarks"),
  };

  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const get = (i: number) => (i >= 0 ? cells[i]?.trim().replace(/^"|"$/g, "") ?? "" : "");
    const num = (i: number) => { const v = Number(get(i)); return isNaN(v) ? null : v; };
    return {
      id: get(col.id),
      timestamp: new Date(get(col.time)),
      text: get(col.text),
      permalink: get(col.permalink) || null,
      impressions: num(col.impressions),
      engagements: num(col.engagements),
      likes: Number(get(col.likes)) || 0,
      retweets: Number(get(col.retweets)) || 0,
      replies: Number(get(col.replies)) || 0,
      bookmarks: num(col.bookmarks),
      profileClicks: num(col.profileClicks),
      videoViews: num(col.videoViews),
    };
  }).filter((p) => p.id || p.text);
}

export function parseTwitterZip(files: ExtractedFile[]): TwitterPost[] {
  const tweetJs = files.find((f) => /\btweet\.js$/i.test(f.path));
  if (tweetJs) return parseTweetJs(tweetJs.text).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const tweetCsv = files.find((f) => /tweets?\.csv$/i.test(f.path) || /tweet_activity/i.test(f.path));
  if (tweetCsv) return parseTweetCsv(tweetCsv.text).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return [];
}

/** Parse a bare analytics CSV uploaded directly (not in a ZIP) */
export function parseTwitterAnalyticsCsv(text: string): TwitterPost[] {
  return parseTweetCsv(text).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
