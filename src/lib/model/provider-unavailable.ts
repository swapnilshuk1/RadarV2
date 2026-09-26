const transientFailures = new Map<string, number>();

export type ModelFailureCode =
  | "MODEL_CREDENTIAL"
  | "MODEL_THROTTLED"
  | "MODEL_PROVIDER"
  | "MODEL_TRANSPORT"
  | "MODEL_TIMEOUT"
  | "MODEL_INVALID_OUTPUT"
  | "MODEL_INVALID_INPUT";

export class ModelFailureError extends Error {
  constructor(
    message: string,
    readonly code: ModelFailureCode,
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "ModelFailureError";
  }

  get transient(): boolean {
    return this.code === "MODEL_THROTTLED" || this.code === "MODEL_PROVIDER" || this.code === "MODEL_TRANSPORT" || this.code === "MODEL_TIMEOUT";
  }
}

/** Formatting/structured-output failure: retry briefly without treating it as provider overload. */
export class ModelInvalidOutputError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs = 2_000) {
    super(message);
    this.name = "ModelInvalidOutputError";
    this.retryAfterMs = Math.max(1_000, Math.ceil(retryAfterMs));
  }
}

export function classifyModelFailure(error: unknown): ModelFailureError {
  if (error instanceof ModelInvalidOutputError) return new ModelFailureError(error.message, "MODEL_INVALID_OUTPUT", error.retryAfterMs);
  if (error instanceof ModelProviderUnavailableError) {
    const code = error.httpStatus === 401 || error.httpStatus === 403 ? "MODEL_CREDENTIAL" : error.httpStatus === 429 ? "MODEL_THROTTLED" : error.httpStatus && error.httpStatus >= 500 ? "MODEL_PROVIDER" : "MODEL_TRANSPORT";
    return new ModelFailureError(error.message, code, error.retryAfterMs);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|abort/i.test(message)) return new ModelFailureError(message, "MODEL_TIMEOUT", 30_000);
  if (/schema|json|output/i.test(message)) return new ModelFailureError(message, "MODEL_INVALID_OUTPUT", 2_000);
  return new ModelFailureError(message, "MODEL_INVALID_INPUT", 0);
}

/** Shared provider-overload backoff: 30s, 60s, 120s cap + <=3s jitter.
 * Retry-After always wins when the provider asks for longer. */
export function nextTransientProviderBackoff(
  key: string,
  providerDelay?: number,
  random: () => number = Math.random,
): number {
  const failures = (transientFailures.get(key) ?? 0) + 1;
  transientFailures.set(key, failures);
  const exponential =
    Math.min(120_000, 30_000 * 2 ** Math.min(failures - 1, 2)) +
    Math.floor(Math.max(0, Math.min(1, random())) * 3_000);
  return Math.max(providerDelay ?? 0, exponential);
}

export function clearTransientProviderBackoff(key: string): void {
  transientFailures.delete(key);
}

/** Operational model failure: never spend semantic repair/job attempts on it. */
export class ModelProviderUnavailableError extends Error {
  readonly retryAfterMs: number;
  constructor(
    message: string,
    readonly httpStatus?: number,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ModelProviderUnavailableError";
    // Throttling/server capacity can clear quickly. Auth/configuration needs intervention.
    this.retryAfterMs =
      retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0
        ? Math.max(1000, Math.ceil(retryAfterMs))
        : httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)
          ? 30_000
          : 15 * 60_000;
  }
}

/** Read only retry metadata; never include provider bodies or credentials in errors. */
export async function providerRetryAfterMs(
  response: Response,
  now = Date.now(),
): Promise<number | undefined> {
  const header = response.headers.get("retry-after")?.trim();
  const seconds = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : NaN;
  const headerDelay = Number.isFinite(seconds)
    ? seconds * 1000
    : header
      ? Date.parse(header) - now
      : NaN;
  let rpcDelay = NaN;
  try {
    const payload = (await response.clone().json()) as {
      error?: { details?: Array<{ "@type"?: string; retryDelay?: string }> };
    };
    for (const detail of payload.error?.details ?? []) {
      if (detail["@type"] !== "type.googleapis.com/google.rpc.RetryInfo") continue;
      const duration = detail.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/);
      if (duration)
        rpcDelay = Math.max(Number.isFinite(rpcDelay) ? rpcDelay : 0, Number(duration[1]) * 1000);
    }
  } catch {
    /* An empty/non-JSON error body does not discard a valid header. */
  }
  const valid = [headerDelay, rpcDelay].filter((delay) => Number.isFinite(delay) && delay >= 0);
  return valid.length ? Math.max(...valid) : undefined;
}
