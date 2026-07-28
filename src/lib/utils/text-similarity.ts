// Cheap, deterministic near-duplicate title detection — no embedding API
// call, just normalized token Jaccard similarity. Good enough to catch
// "AI-Native Product Teams in 2026: The New Baseline" vs a rephrasing of
// the same underlying story, which prompt-only dedup instructions let
// through in production.

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are",
  "with", "how", "what", "why", "your", "you", "this", "that", "new", "vs",
  "into", "from", "about", "will", "can", "why",
]);

function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

export function titleSimilarity(a: string, b: string): number {
  const setA = titleWords(a);
  const setB = titleWords(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function isNearDuplicateTitle(a: string, b: string, threshold = 0.5): boolean {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  return titleSimilarity(a, b) >= threshold;
}

export function findNearDuplicate(candidate: string, existing: string[], threshold = 0.5): string | null {
  return existing.find((t) => isNearDuplicateTitle(candidate, t, threshold)) ?? null;
}
