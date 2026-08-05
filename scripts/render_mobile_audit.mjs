import { chromium } from "playwright-extra";
import path from "path";
import fs from "fs";

async function auditMobile() {
  const artifactDir = "C:\\Users\\swapn\\.gemini\\antigravity\\brain\\ce7d2ebc-8990-4629-8871-46c6504603ff";
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
  });

  const page = await context.newPage();

  console.log("Navigating to http://130.210.40.98.sslip.io/...");
  await page.goto("http://130.210.40.98.sslip.io/", { waitUntil: "domcontentloaded" });

  // Set sessionStorage session
  await page.evaluate(() => {
    sessionStorage.setItem("radar_session", JSON.stringify({
      userId: "swapnil-shukla-dev",
      email: "swapnil@radar.advisory",
      name: "Swapnil Shukla",
      onboarded: true
    }));
  });

  // Reload to apply authenticated session
  await page.goto("http://130.210.40.98.sslip.io/", { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const shortlistScreenshotPath = path.join(artifactDir, "mobile_audit_shortlist_authenticated.png");
  await page.screenshot({ path: shortlistScreenshotPath, fullPage: true });
  console.log("Saved authenticated shortlist screenshot to:", shortlistScreenshotPath);

  // Inspect DOM metrics on Shortlist
  const shortlistMetrics = await page.evaluate(() => {
    const documentWidth = document.documentElement.scrollWidth;
    const viewportWidth = window.innerWidth;
    
    const overflowingElements = [];
    document.querySelectorAll("*").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.right > viewportWidth + 2) {
        overflowingElements.push({
          tagName: el.tagName,
          className: el.className,
          width: Math.round(rect.width),
          right: Math.round(rect.right),
          text: el.textContent?.trim().substring(0, 35)
        });
      }
    });

    return {
      documentWidth,
      viewportWidth,
      isOverflowing: documentWidth > viewportWidth,
      overflowCount: overflowingElements.length,
      overflowingElements: overflowingElements.slice(0, 10)
    };
  });

  console.log("\n=== AUTHENTICATED SHORTLIST METRICS ===");
  console.log(JSON.stringify(shortlistMetrics, null, 2));

  // Click expand (+) on first row to inspect expanded card brief rendering
  const expandButton = page.locator("button", { hasText: "+" }).first();
  if (await expandButton.isVisible()) {
    console.log("Expanding first brief row...");
    await expandButton.click();
    await page.waitForTimeout(1000);
    const expandedScreenshotPath = path.join(artifactDir, "mobile_audit_shortlist_expanded.png");
    await page.screenshot({ path: expandedScreenshotPath, fullPage: true });
    console.log("Saved expanded brief screenshot to:", expandedScreenshotPath);
  }

  // Navigate to first Brief Dossier page
  const dossierLink = page.locator('a[href*="/opportunity/"]').first();
  if (await dossierLink.isVisible()) {
    const href = await dossierLink.getAttribute("href");
    console.log(`Navigating to dossier page: ${href}...`);
    await page.goto(`http://130.210.40.98.sslip.io${href}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const dossierScreenshotPath = path.join(artifactDir, "mobile_audit_dossier_authenticated.png");
    await page.screenshot({ path: dossierScreenshotPath, fullPage: true });
    console.log("Saved authenticated dossier screenshot to:", dossierScreenshotPath);
  }

  await browser.close();
}

auditMobile().catch(console.error);
