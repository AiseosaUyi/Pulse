"use client";

import { unzip } from "fflate";
import type { OwnMetricsPlatform } from "@/lib/types/own-metrics";

export interface ExtractedFile {
  path: string;
  text: string;
}

/** Paths that contain media — skip them to avoid reading GBs of binary data */
const SKIP_PREFIXES = ["/media/", "/photos/", "/videos/", "/stories_archival/"];

function isMediaPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    SKIP_PREFIXES.some((p) => lower.includes(p)) ||
    /\.(jpg|jpeg|png|mp4|mov|gif|webp|heic|m4v|avi|mkv|wav|mp3|aac)$/i.test(lower)
  );
}

function isAnalyticsFile(path: string): boolean {
  if (isMediaPath(path)) return false;
  return /\.(json|csv|js|html|htm|txt)$/i.test(path);
}

/**
 * Extract analytics-relevant text files from a ZIP, skipping all media.
 * Runs entirely in the browser — the ZIP never uploads to the server.
 */
export function extractZip(file: File): Promise<ExtractedFile[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buf = e.target?.result as ArrayBuffer;
      unzip(new Uint8Array(buf), (err, files) => {
        if (err) { reject(err); return; }
        const results: ExtractedFile[] = [];
        const dec = new TextDecoder("utf-8", { fatal: false });
        for (const [path, data] of Object.entries(files)) {
          if (!isAnalyticsFile(path)) continue;
          // Skip very large files (> 8 MB) to avoid memory issues
          if (data.byteLength > 8 * 1024 * 1024) continue;
          try {
            results.push({ path, text: dec.decode(data) });
          } catch {
            // skip undecodable
          }
        }
        resolve(results);
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Detect which platform a ZIP belongs to based on folder names */
export function detectZipPlatform(files: ExtractedFile[]): OwnMetricsPlatform | null {
  const paths = files.map((f) => f.path.toLowerCase());
  if (paths.some((p) => p.includes("your_instagram_activity") || p.includes("instagram"))) return "instagram";
  if (paths.some((p) => p.includes("tweet.js") || p.includes("tweets.csv") || p.includes("twitter"))) return "twitter";
  if (paths.some((p) => p.includes("user_data.json") || p.includes("tiktok"))) return "tiktok";
  if (paths.some((p) => p.includes("linkedin"))) return "linkedin";
  return null;
}
