import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/ai/csv-maps";

const TIKTOK_CSV = `Video views,Likes,Comments,Shares,Video description,Video link,Posting time
9000,1234,56,78,My viral dance,https://tiktok.com/v/1,2024-03-01
5000,500,20,10,Second video,https://tiktok.com/v/2,2024-03-02`;

const INSTAGRAM_CSV = `Reach,Impressions,Likes,Comments,Saves,Permalink,Publish time
12000,15000,800,45,120,https://instagram.com/p/abc,2024-02-14
8000,10000,600,30,90,https://instagram.com/p/def,2024-02-15`;

const LINKEDIN_CSV = `Impressions (total),Reactions (total),Comments (total),Reposts (total),Post URL,Created time
5000,200,15,8,https://linkedin.com/post/1,2024-01-10`;

const TWITTER_CSV = `Impressions,Likes,Replies,Retweets,Tweet text,Tweet permalink,Time
50000,3200,180,450,Some tweet text,https://x.com/user/status/1,2024-01-15`;

describe("parseCsv — TikTok", () => {
  it("parses all rows", () => {
    const result = parseCsv("tiktok", TIKTOK_CSV);
    expect(result.rows.length).toBe(2);
  });

  it("extracts views and engagement", () => {
    const first = parseCsv("tiktok", TIKTOK_CSV).rows[0];
    expect(first.metrics.views).toBe(9000);
    expect(first.metrics.likes).toBe(1234);
    expect(first.metrics.comments).toBe(56);
    expect(first.metrics.shares).toBe(78);
  });

  it("extracts title and url", () => {
    const first = parseCsv("tiktok", TIKTOK_CSV).rows[0];
    // "Video description" matches the `title` alias before `caption` in the map
    expect(first.title).toBe("My viral dance");
    expect(first.externalUrl).toBe("https://tiktok.com/v/1");
    expect(first.postedAt).toBe("2024-03-01");
  });

  it("reports no unrecognized headers on a clean export", () => {
    const result = parseCsv("tiktok", TIKTOK_CSV);
    expect(result.unrecognizedHeaders.length).toBe(0);
  });
});

describe("parseCsv — Instagram", () => {
  it("parses all rows", () => {
    expect(parseCsv("instagram", INSTAGRAM_CSV).rows.length).toBe(2);
  });

  it("extracts reach, impressions, saves", () => {
    const first = parseCsv("instagram", INSTAGRAM_CSV).rows[0];
    expect(first.metrics.reach).toBe(12000);
    expect(first.metrics.impressions).toBe(15000);
    expect(first.metrics.saves).toBe(120);
  });
});

describe("parseCsv — LinkedIn", () => {
  it("parses impressions and reactions from aliased headers", () => {
    const first = parseCsv("linkedin", LINKEDIN_CSV).rows[0];
    expect(first.metrics.impressions).toBe(5000);
    expect(first.metrics.likes).toBe(200); // "Reactions (total)" maps to likes
    expect(first.metrics.shares).toBe(8);  // "Reposts (total)" maps to shares
  });
});

describe("parseCsv — Twitter", () => {
  it("parses impressions and engagement", () => {
    const first = parseCsv("twitter", TWITTER_CSV).rows[0];
    // "Impressions" header matches the `views` alias first in the twitter map
    expect(first.metrics.views).toBe(50000);
    expect(first.metrics.likes).toBe(3200);
    expect(first.metrics.comments).toBe(180); // Replies
    expect(first.metrics.shares).toBe(450);   // Retweets
  });
});

describe("parseCsv — edge cases", () => {
  it("returns empty rows for fewer than 2 lines", () => {
    expect(parseCsv("tiktok", "").rows.length).toBe(0);
    expect(parseCsv("tiktok", "just a header row").rows.length).toBe(0);
  });

  it("strips commas from formatted numbers like '1,234'", () => {
    const csv = `Video views,Likes\n"1,234","5,678"`;
    const result = parseCsv("tiktok", csv);
    expect(result.rows[0].metrics.views).toBe(1234);
    expect(result.rows[0].metrics.likes).toBe(5678);
  });

  it("reports unrecognized headers", () => {
    const csv = `Video views,Likes,Unknown Column A,Unknown Column B\n1000,500,foo,bar`;
    const result = parseCsv("tiktok", csv);
    expect(result.unrecognizedHeaders).toContain("Unknown Column A");
    expect(result.unrecognizedHeaders).toContain("Unknown Column B");
  });

  it("skips rows with no parseable metrics", () => {
    const csv = `Video views,Likes\nN/A,N/A\n1000,500`;
    const result = parseCsv("tiktok", csv);
    // Both rows are parsed; the caller filters on Object.keys(metrics).length > 0
    // The N/A row will have an empty metrics object
    const withMetrics = result.rows.filter(
      (r) => Object.keys(r.metrics).length > 0
    );
    expect(withMetrics.length).toBe(1);
    expect(withMetrics[0].metrics.views).toBe(1000);
  });
});
