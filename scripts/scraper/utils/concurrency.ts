// Minimal promise pool — no external deps.
export async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>
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
        // Store rejection as-is — caller decides retry policy.
        results[i] = err as any;
      }
    }
  });
  await Promise.all(runners);
  return results;
}
