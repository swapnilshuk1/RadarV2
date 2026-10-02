// Minimal promise pool — no external deps.
export async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
  onError?: (error: unknown, item: T) => void | Promise<void>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        await onError?.(err, items[i]);
        // Store rejection as-is — caller decides retry policy.
        results[i] = err as any;
      }
    }
  });
  // A reporting/persistence callback can itself fail. Keep execution ownership
  // until every other portal has settled before the caller closes shared resources.
  const settled = await Promise.allSettled(runners);
  const failure = settled.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results;
}
