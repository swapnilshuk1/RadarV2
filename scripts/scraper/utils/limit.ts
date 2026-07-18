export type Limiter = {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  activeCount: number;
  pendingCount: number;
};

export function createLimiter(concurrency: number): Limiter {
  let active = 0;
  const queue: Array<{
    fn: () => Promise<any>;
    resolve: (val: any) => void;
    reject: (err: any) => void;
  }> = [];

  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift()!;
    
    // Execute the function
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        active--;
        next();
      });
  };

  return {
    run: <T>(fn: () => Promise<T>): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
    },
    get activeCount() {
      return active;
    },
    get pendingCount() {
      return queue.length;
    }
  };
}
