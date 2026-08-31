/**
 * scripts/benchmarks/test_category_and_decisions.ts
 */
import { chromium } from "playwright";
import { generateSessionToken, createSession } from "../../src/lib/auth/session";

async function main() {
  const userId = "ms6i7e3y-4x0chy5fy";
  const token = generateSessionToken();
  await createSession(token, userId);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

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

  // 1. Visit /decisions
  console.log("1. Visiting /decisions...");
  const t0 = performance.now();
  await page.goto("http://130.210.41.232.sslip.io/decisions", { waitUntil: "commit", timeout: 15000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("main", { timeout: 10000 });
  const decTime = performance.now() - t0;
  console.log(`/decisions loaded in: ${decTime.toFixed(2)} ms`);

  const decScreenshot = "C:/Users/swapn/.gemini/antigravity/brain/ab3f2cfb-d191-4737-97c6-90461284a8e0/decisions_live.png";
  await page.screenshot({ path: decScreenshot, fullPage: true });
  console.log("Decisions screenshot saved to:", decScreenshot);

  // 2. Visit / and click "NEEDS MORE SIGNAL"
  console.log("\n2. Visiting / and clicking NEEDS MORE SIGNAL...");
  await page.goto("http://130.210.41.232.sslip.io/", { waitUntil: "commit", timeout: 15000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("button:has-text('NEEDS MORE SIGNAL')", { timeout: 10000 });

  await page.click("button:has-text('NEEDS MORE SIGNAL')");
  await page.waitForTimeout(1000);

  const needsSignalScreenshot = "C:/Users/swapn/.gemini/antigravity/brain/ab3f2cfb-d191-4737-97c6-90461284a8e0/needs_more_signal_live.png";
  await page.screenshot({ path: needsSignalScreenshot, fullPage: true });
  console.log("Needs More Signal screenshot saved to:", needsSignalScreenshot);

  await browser.close();
}

main().catch(console.error);
