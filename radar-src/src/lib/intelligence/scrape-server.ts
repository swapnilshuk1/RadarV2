import { createServerFn } from "@tanstack/react-start";

export const triggerScrapeFn = createServerFn({ method: "POST" })
  .handler(async () => {
    try {
      console.log("[Server] triggerScrapeFn: launching resumable live scraper…");
      // Dynamic import isolates Playwright/Node modules from the browser bundler.
      const { run: runScraper } = await import("../../../scripts/scrape");
      const result = await runScraper({ resume: true });
      return { success: result.success, count: result.count, runId: result.runId };
    } catch (error: any) {
      console.error("[Server] triggerScrapeFn failed:", error);
      return { success: false, error: error?.message ?? String(error) };
    }
  });
