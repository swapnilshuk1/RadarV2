/**
 * src/lib/intelligence/rematerialization/AsyncConcurrencyPool.ts
 *
 * Lightweight, zero-dependency bounded concurrency pool for parallel batch execution.
 * Guarantees that active async tasks never exceed configured concurrency limit,
 * while isolating individual task errors and tracking peak concurrency.
 */

export interface PoolExecutionResult<R> {
  readonly results: R[];
  readonly peakConcurrency: number;
}

export class AsyncConcurrencyPool {
  /**
   * Executes tasks over items with a strict upper bound on active concurrency.
   */
  public static async mapBounded<T, R>(
    items: readonly T[],
    fn: (item: T, index: number) => Promise<R>,
    concurrency: number = 8
  ): Promise<PoolExecutionResult<R>> {
    if (items.length === 0) {
      return { results: [], peakConcurrency: 0 };
    }

    const maxWorkers = Math.max(1, Math.min(concurrency, items.length));
    const results: R[] = new Array(items.length);
    let nextIndex = 0;
    let activeWorkers = 0;
    let peakConcurrency = 0;

    return new Promise<PoolExecutionResult<R>>((resolve, reject) => {
      let hasError = false;

      const runWorker = async () => {
        while (nextIndex < items.length && !hasError) {
          const currentIndex = nextIndex++;
          const item = items[currentIndex];

          activeWorkers++;
          if (activeWorkers > peakConcurrency) {
            peakConcurrency = activeWorkers;
          }

          try {
            results[currentIndex] = await fn(item, currentIndex);
          } catch (err) {
            // Uncaught catastrophic error in worker callback
            hasError = true;
            reject(err);
            return;
          } finally {
            activeWorkers--;
          }
        }

        if (activeWorkers === 0 && (nextIndex >= items.length || hasError)) {
          resolve({ results, peakConcurrency });
        }
      };

      for (let i = 0; i < maxWorkers; i++) {
        runWorker().catch((err) => {
          if (!hasError) {
            hasError = true;
            reject(err);
          }
        });
      }
    });
  }
}
