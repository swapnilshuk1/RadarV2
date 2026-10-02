/** Prevent synchronous SQLite busy waits from blocking their own async commit.
 * File locks still arbitrate between processes; this queue only coordinates
 * operations sharing an event loop. Transaction callbacks use their tx adapter.
 */
const state = globalThis as typeof globalThis & {
  __RADAR_LOCAL_DB_QUEUES__?: Map<string | object, Promise<void>>;
};
export async function serializeLocal<T>(key: string | object, run: () => Promise<T>): Promise<T> {
  const queues = (state.__RADAR_LOCAL_DB_QUEUES__ ??= new Map());
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(key, next);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (queues.get(key) === next) queues.delete(key);
  }
}
