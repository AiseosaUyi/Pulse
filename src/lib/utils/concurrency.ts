// Runs `fn` over `items` with at most `limit` in flight at once, preserving
// input order in the result. Used anywhere a batch of independent async
// calls should be spread out instead of firing all at once (e.g. to avoid
// looking like a burst to an origin that rate-limits/blocks concurrent
// requests, or to bound total concurrent LLM/search calls in a batch).
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
