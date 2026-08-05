import { chromium } from 'playwright';
import path from 'path';

async function auditLiveInstance() {
  const browser = await chromium.launch({ headless: true });
  const artifactDir = 'C:/Users/swapn/.gemini/antigravity/brain/ce7d2ebc-8990-4629-8871-46c6504603ff';

  console.log('--- Starting Playwright QC Audit on Live Instance (130.210.41.232.sslip.io) ---');

  // 1. Audit Login Page on Mobile 375px
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  const mobilePage = await mobileContext.newPage();
  console.log('Navigating Mobile viewport to http://130.210.41.232.sslip.io/login ...');
  await mobilePage.goto('http://130.210.41.232.sslip.io/login', { waitUntil: 'networkidle' });

  const mobileLoginScreenshotPath = path.join(artifactDir, 'qc_live_login_mobile.png');
  await mobilePage.screenshot({ path: mobileLoginScreenshotPath, fullPage: true });
  console.log(`Saved mobile login screenshot: ${mobileLoginScreenshotPath}`);

  // Check overflow on mobile login
  const mobileOverflow = await mobilePage.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  console.log(`Mobile horizontal overflow detected: ${mobileOverflow}`);

  // 2. Click Direct Executive Access & Wait for Navigation to Shortlist Dashboard
  console.log('Clicking Direct Executive Access button ...');
  const directBtn = mobilePage.locator('button:has-text("Direct Executive Access")');
  if (await directBtn.isVisible()) {
    await directBtn.click();
    await mobilePage.waitForURL('http://130.210.41.232.sslip.io/', { timeout: 15000 });
    await mobilePage.waitForLoadState('networkidle');
  }

  const mobileAppScreenshotPath = path.join(artifactDir, 'qc_live_app_mobile.png');
  await mobilePage.screenshot({ path: mobileAppScreenshotPath, fullPage: true });
  console.log(`Saved mobile shortlist screenshot: ${mobileAppScreenshotPath}`);

  // Check overflow on mobile dashboard
  const appMobileOverflow = await mobilePage.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  console.log(`Mobile Dashboard horizontal overflow detected: ${appMobileOverflow}`);

  // 3. Desktop 1440px Audit
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const desktopPage = await desktopContext.newPage();
  console.log('Navigating Desktop viewport to http://130.210.41.232.sslip.io/login ...');
  await desktopPage.goto('http://130.210.41.232.sslip.io/login', { waitUntil: 'networkidle' });

  const deskBtn = desktopPage.locator('button:has-text("Direct Executive Access")');
  if (await deskBtn.isVisible()) {
    await deskBtn.click();
    await desktopPage.waitForURL('http://130.210.41.232.sslip.io/', { timeout: 15000 });
    await desktopPage.waitForLoadState('networkidle');
  }

  const desktopScreenshotPath = path.join(artifactDir, 'qc_live_app_desktop.png');
  await desktopPage.screenshot({ path: desktopScreenshotPath, fullPage: true });
  console.log(`Saved desktop shortlist screenshot: ${desktopScreenshotPath}`);

  await browser.close();
  console.log('--- Playwright QC Audit Complete ---');
}

auditLiveInstance().catch((err) => {
  console.error('Playwright QC Audit Failed:', err);
  process.exit(1);
});
