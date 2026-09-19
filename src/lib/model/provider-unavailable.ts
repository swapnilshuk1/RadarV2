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
