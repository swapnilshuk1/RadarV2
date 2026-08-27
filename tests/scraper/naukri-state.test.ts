import { describe, test, expect } from "vitest";
import fs from "fs";
import path from "path";
import { classifyNaukriHtml } from "../../scripts/scraper/portals/naukri";

describe("P1: Naukri Portal-State Recognition & Failure Classification", () => {
  test("Test A: Normal Naukri result page with cards is classified as RESULTS", () => {
    const html = `
      <html>
        <head><title>VP Marketing Jobs - Naukri.com</title></head>
        <body>
          <div class="srp-jobtuple-wrapper" data-job-id="12345">
            <a class="title">Vice President Marketing</a>
            <a class="comp-name">Acme Corp</a>
            <span class="loc">Bengaluru</span>
          </div>
          <div class="srp-jobtuple-wrapper" data-job-id="12346">
            <a class="title">Chief Growth Officer</a>
            <a class="comp-name">TechGlobal</a>
            <span class="loc">Remote</span>
          </div>
        </body>
      </html>
    `;

    const state = classifyNaukriHtml(html, "VP Marketing Jobs - Naukri.com");
    expect(state.state).toBe("RESULTS");
    if (state.state === "RESULTS") {
      expect(state.count).toBeGreaterThan(0);
    }
  });

  test("Test B: Captured failure fixture (Naukri TopTier SPA Shell) is NOT classified as zero-results", () => {
    const fixturePath = path.join(
      process.cwd(),
      ".scraper-artifacts/failures/2026-08-21/run-1787338445603/naukri/1787338790350-page.html"
    );

    expect(fs.existsSync(fixturePath)).toBe(true);
    const fixtureHtml = fs.readFileSync(fixturePath, "utf-8");
    const pageTitle = "Chief Marketing Officer Jobs In India - 25528 Chief Marketing Officer Job Vacancies In India - Naukri.com";

    const state = classifyNaukriHtml(fixtureHtml, pageTitle);

    // Invariant: TopTier shell must be classified as TOPTIER_SHELL, never ZERO_RESULTS or 0 search results
    expect(state.state).toBe("TOPTIER_SHELL");
    if (state.state === "TOPTIER_SHELL") {
      expect(state.marker).toContain("Naukri TopTier");
    }
  });

  test("Test C: Legitimate zero-results page is classified as ZERO_RESULTS", () => {
    const html = `
      <html>
        <head><title>Jobs Search - Naukri.com</title></head>
        <body>
          <div class="styles_zero-result-wrapper">
            <div class="zero-result">No matching jobs found for your search criteria.</div>
            <p>Try searching with different keywords or broader location filters.</p>
          </div>
        </body>
      </html>
    `;

    const state = classifyNaukriHtml(html, "Jobs Search - Naukri.com");
    expect(state.state).toBe("ZERO_RESULTS");
    if (state.state === "ZERO_RESULTS") {
      expect(state.reason).toBeDefined();
    }
  });

  test("Test D: Security challenge / Bot block is classified as BLOCKED", () => {
    const html = `<html><head><title>Just a moment...</title></head><body>Cloudflare DDoS protection</body></html>`;
    const state = classifyNaukriHtml(html, "Just a moment...");
    expect(state.state).toBe("BLOCKED");
    if (state.state === "BLOCKED") {
      expect(state.title).toBe("Just a moment...");
    }
  });

  test("Test E: Generic unhydrated Next.js SPA shell without cards or zero-results is classified as UNHYDRATED_SPA", () => {
    const html = `
      <html>
        <head><title>Naukri Jobs Search</title></head>
        <body>
          <div id="__next">
            <div id="app-root"></div>
          </div>
        </body>
      </html>
    `;

    const state = classifyNaukriHtml(html, "Naukri Jobs Search");
    expect(state.state).toBe("UNHYDRATED_SPA");
  });
});
