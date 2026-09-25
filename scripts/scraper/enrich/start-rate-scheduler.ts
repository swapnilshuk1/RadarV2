export interface StartLease {
  queueWaitMs: number;
  inFlightAtStart: number;
  release(): void;
}

type Pending = { queuedAt: number; resolve: (lease: StartLease) => void };

/** Limits request starts without serializing request completion. */
export class StartRateScheduler {
  private readonly pending: Pending[] = [];
  private inFlight = 0;
  private lastStartAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly minStartIntervalMs: number,
    private readonly maxInFlight: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(minStartIntervalMs) || minStartIntervalMs < 0)
      throw new Error("INVALID_MIN_START_INTERVAL");
    if (!Number.isInteger(maxInFlight) || maxInFlight < 1) throw new Error("INVALID_MAX_IN_FLIGHT");
  }

  acquire(): Promise<StartLease> {
    return new Promise((resolve) => {
      this.pending.push({ queuedAt: this.now(), resolve });
      this.drain();
    });
  }

  private drain(): void {
    if (this.timer || this.inFlight >= this.maxInFlight || this.pending.length === 0) return;
    const delay = Math.max(0, this.lastStartAt + this.minStartIntervalMs - this.now());
    if (delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.drain();
      }, delay);
      return;
    }
    const next = this.pending.shift()!;
    this.inFlight += 1;
    this.lastStartAt = this.now();
    let released = false;
    next.resolve({
      queueWaitMs: this.lastStartAt - next.queuedAt,
      inFlightAtStart: this.inFlight,
      release: () => {
        if (released) return;
        released = true;
        this.inFlight -= 1;
        this.drain();
      },
    });
    this.drain();
  }
}
