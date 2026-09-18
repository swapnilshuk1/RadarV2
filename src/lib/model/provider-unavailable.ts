/** Operational model failure: never spend semantic repair/job attempts on it. */
export class ModelProviderUnavailableError extends Error {
  readonly retryAfterMs = 15 * 60_000;
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
    this.name = 'ModelProviderUnavailableError';
  }
}
