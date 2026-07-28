// Round-robins pillar assignment across a batch so every configured pillar
// is GUARANTEED at least floor(n/pillars.length) slots (and the remainder
// spread across the first few, in rotating order) instead of leaving
// coverage up to the model's voluntary compliance with a "spread pillars"
// instruction — confirmed live: that soft instruction let 1-2 dominant
// pillars eat an entire batch while others never appeared.
export function buildPillarAssignments(niches: string[], n: number): string[] {
  if (niches.length === 0) return [];
  return Array.from({ length: n }, (_, i) => niches[i % niches.length]);
}
