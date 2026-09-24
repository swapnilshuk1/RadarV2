import { AcquisitionIntegrityError } from "../../../src/lib/acquisition/CanonicalIngestionService";

const TRANSIENT_SQLITE_CODES = new Set([
  "SQLITE_BUSY",
  "SQLITE_BUSY_RECOVERY",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_BUSY_TIMEOUT",
  "SQLITE_LOCKED",
  "SQLITE_LOCKED_SHAREDCACHE",
]);

export interface PersistenceCoordinatorOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

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
        return;
      }
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isTransientPersistenceContention(error: unknown): boolean {
  let current: any = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const code = typeof current.code === "string" ? current.code.toUpperCase() : "";
    if (TRANSIENT_SQLITE_CODES.has(code)) return true;

    const message = errorMessage(current);
    if (
      /SQLITE_(?:BUSY|LOCKED)/i.test(message) ||
      /database(?: table)? is locked/i.test(message) ||
      /cannot commit transaction\s*-\s*SQL statements in progress/i.test(message)
    ) {
      return true;
    }

    current = current.cause;
  }
  return false;
}

export class PersistenceUnavailableError extends AcquisitionIntegrityError {
  readonly code = "PERSISTENCE_UNAVAILABLE";

  constructor(
    readonly operationName: string,
    readonly attempts: number,
    cause: unknown,
  ) {
    super(
      `[PERSISTENCE_UNAVAILABLE] ${operationName} failed after ${attempts} attempt(s): ${errorMessage(cause)}`,
      cause,
    );
    this.name = "PersistenceUnavailableError";
  }
}

export class PersistenceWriteCoordinator {
  private readonly mutex = new AsyncMutex();
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitter: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: PersistenceCoordinatorOptions = {}) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    this.baseDelayMs = Math.max(0, options.baseDelayMs ?? 50);
    this.maxDelayMs = Math.max(this.baseDelayMs, options.maxDelayMs ?? 800);
    this.jitter = options.jitter ?? Math.random;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run<T>(operationName: string, fn: () => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          return await fn();
        } catch (error) {
          lastError = error;
          const transient = isTransientPersistenceContention(error);

          if (!transient) {
            if (error instanceof AcquisitionIntegrityError) throw error;
            throw new AcquisitionIntegrityError(
              `Persistence failure during ${operationName}: ${errorMessage(error)}`,
              error,
            );
          }

          if (attempt >= this.maxAttempts) {
            throw new PersistenceUnavailableError(operationName, attempt, error);
          }

          const exponential = Math.min(
            this.maxDelayMs,
            this.baseDelayMs * Math.pow(2, attempt - 1),
          );
          const jitterFactor = 0.8 + Math.min(1, Math.max(0, this.jitter())) * 0.4;
          await this.sleep(Math.round(exponential * jitterFactor));
        }
      }

      throw new PersistenceUnavailableError(operationName, this.maxAttempts, lastError);
    });
  }
}

const scraperPersistenceCoordinator = new PersistenceWriteCoordinator();

export async function withPersistenceBoundary<T>(
  operationName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return scraperPersistenceCoordinator.run(operationName, fn);
}
