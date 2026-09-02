import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  console.log("Navigating to live production site...");
  await context.addCookies([
    {
      name: "radar_user",
      value: "ms6i7e3y-4x0chy5fy",
      domain: "130.210.41.232.sslip.io",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript(() => {
    sessionStorage.setItem(
      "radar_session",
      JSON.stringify({ name: "Swapnil Shukla", email: "swapnil@radar.local", role: "executive" })
    );
  });

  await page.goto("http://130.210.41.232.sslip.io/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  const screenshotPath = "C:/Users/swapn/.gemini/antigravity/brain/ab3f2cfb-d191-4737-97c6-90461284a8e0/shortlist_metrics_verified.png";
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log("Screenshot saved to:", screenshotPath);

  await browser.close();
}

main().catch(console.error);
