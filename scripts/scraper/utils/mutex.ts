/**
 * scripts/scraper/utils/mutex.ts
 * 
 * Page-Level Navigation Mutex.
 * Guarantees that exactly one navigation owner holds a Playwright Page instance at any instant,
 * eliminating "Navigation interrupted by another navigation" errors.
 */

export class PageMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.locked = false;
    }
  }
}

const pageMutexes = new WeakMap<any, PageMutex>();

export function getPageMutex(page: any): PageMutex {
  if (!pageMutexes.has(page)) {
    pageMutexes.set(page, new PageMutex());
  }
  return pageMutexes.get(page)!;
}
