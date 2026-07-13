import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Truncates to at most `maxLength` UTF-16 code units without splitting a
 * surrogate pair (emoji, and other supplementary-plane characters are two
 * code units in JS strings). A plain `.slice(0, maxLength)` can land
 * between the two halves, leaving a lone surrogate — `encodeURIComponent`
 * (and `decodeURIComponent`/`escape`/`unescape`) throw `URIError: URI
 * malformed` on that input. Always use this before encoding user- or
 * scraped-content strings (tweet text, post captions, etc.) for a URL. */
export function truncateSafe(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = maxLength;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}
