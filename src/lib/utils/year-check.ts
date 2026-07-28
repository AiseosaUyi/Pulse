// Flags a title carrying over a stale year from a scraped trend headline
// (e.g. "...Innovations for 2023" or "vibe coding 2025" surfacing in a
// mid-2026 batch, because the source article's own headline had that year
// baked in). Purely deterministic — a regex extraction + numeric
// comparison, no LLM call needed for something this mechanical.
const YEAR_PATTERN = /\b(19|20)\d{2}\b/g;

export function findStaleYear(title: string, currentYear: number): number | null {
  const matches = title.match(YEAR_PATTERN);
  if (!matches) return null;
  for (const m of matches) {
    const year = parseInt(m, 10);
    if (year < currentYear) return year;
  }
  return null;
}
