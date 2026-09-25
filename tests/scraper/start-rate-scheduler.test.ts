import { describe, expect, it } from "vitest";
import { StartRateScheduler } from "../../scripts/scraper/enrich/start-rate-scheduler";

describe("StartRateScheduler", () => {
  it("spaces starts while permitting two in-flight requests", async () => {
    const scheduler = new StartRateScheduler(25, 2);
    const first = await scheduler.acquire();
    const startedAt = Date.now();
    const second = await scheduler.acquire();
    expect(second.inFlightAtStart).toBe(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    first.release();
    second.release();
  });

  it("holds a third request until an in-flight request releases", async () => {
    const scheduler = new StartRateScheduler(0, 2);
    const first = await scheduler.acquire();
    const second = await scheduler.acquire();
    let started = false;
    const thirdPromise = scheduler.acquire().then((lease) => {
      started = true;
      return lease;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toBe(false);
    first.release();
    const third = await thirdPromise;
    expect(third.inFlightAtStart).toBe(2);
    second.release();
    third.release();
  });
});
