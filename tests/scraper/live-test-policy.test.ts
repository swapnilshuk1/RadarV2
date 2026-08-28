import { describe, it, expect } from "vitest";

describe("Live Test Policy Safety", () => {
  it("RUN_LIVE_SCRAPER_TESTS is not enabled by default", () => {
    expect(process.env.RUN_LIVE_SCRAPER_TESTS).not.toBe("true");
  });
});
