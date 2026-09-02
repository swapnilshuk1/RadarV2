/**
 * scripts/benchmarks/capture_live_screenshot.ts
 */
import { chromium } from "playwright";
import { generateSessionToken, createSession } from "../../src/lib/auth/session";

async function main() {
  const userId = "ms6i7e3y-4x0chy5fy";
  const token = generateSessionToken();
  await createSession(token, userId);
  console.log("Created session for user:", userId);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  await context.addCookies([
    {
      name: "radar_session",
      value: token,
      domain: "130.210.41.232.sslip.io",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();
  console.log("Navigating to http://130.210.41.232.sslip.io/ ...");

  const t0 = performance.now();
  const res = await page.goto("http://130.210.41.232.sslip.io/", { waitUntil: "commit", timeout: 20000 });
  const ttfb = performance.now() - t0;

  await page.waitForLoadState("domcontentloaded");
  const domTime = performance.now() - t0;

  await page.waitForSelector("main, h1, .glass-card", { timeout: 15000 });
  const loadTime = performance.now() - t0;

  console.log(`HTTP Status:             ${res?.status()}`);
  console.log(`Time to First Byte:      ${ttfb.toFixed(2)} ms`);
  console.log(`DOM Ready Time:          ${domTime.toFixed(2)} ms`);
  console.log(`Full Render / Hydration: ${loadTime.toFixed(2)} ms`);

  // Wait 1s for any transitions
  await page.waitForTimeout(1000);

  // Check card items
  const cards = await page.$$("li.glass-card, [data-testid='opportunity-card'], li");
  console.log(`Found ${cards.length} list items / cards on the page.`);

  const screenshotPath = "C:/Users/swapn/.gemini/antigravity/brain/ab3f2cfb-d191-4737-97c6-90461284a8e0/shortlist_live_verified.png";
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log("Screenshot saved to:", screenshotPath);

  await browser.close();
}

main().catch(console.error);
