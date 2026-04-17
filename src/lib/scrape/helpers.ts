// Shared parsing helpers for Apify-backed scrapers.
// Handles flat-dot-notation keys ("authorMeta.name") and nested objects
// (author.meta.name) uniformly.

export type ActorItem = Record<string, unknown>;

function nested<T>(item: ActorItem, path: string[]): T | undefined {
  let cur: unknown = item;
  for (const key of path) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur as T;
}

export function probe<T>(
  item: ActorItem,
  ...paths: (string | string[])[]
): T | undefined {
  for (const p of paths) {
    const value = Array.isArray(p)
      ? nested<T>(item, p)
      : (item[p] as T | undefined);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export function extractHashtagsFromText(text: string): string[] {
  const matches = text.match(/#[\w_]+/g) ?? [];
  return matches.map((h) => h.slice(1).toLowerCase());
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
