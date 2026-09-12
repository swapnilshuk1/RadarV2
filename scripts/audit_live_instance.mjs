import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function auditLive() {
  const artifactDir = 'C:\\Users\\swapn\\.gemini\\antigravity\\brain\\ce7d2ebc-8990-4629-8871-46c6504603ff\\.tempmediaStorage';
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  const targetUrl = 'http://130.210.41.232';

  console.log(`[Audit] Auditing live production target: ${targetUrl}`);

  // 1. Desktop Viewport (1440x900)
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const desktopPage = await desktopContext.newPage();
  const resp = await desktopPage.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 });
  console.log(`[Audit] HTTP Status: ${resp ? resp.status() : 'No response'}`);
  await desktopPage.waitForTimeout(2000);

  const desktopPath = path.join(artifactDir, `live_desktop_${Date.now()}.png`);
  await desktopPage.screenshot({ path: desktopPath, fullPage: false });
  console.log(`[Audit] Captured Desktop Screenshot: ${desktopPath}`);

  // Check login button / state
  const loginBtn = await desktopPage.$('a[href="/login"], button:has-text("Sign in"), button:has-text("Login")');
  console.log(`[Audit] Desktop Login Element found: ${Boolean(loginBtn)}`);

  await desktopContext.close();

  // 2. Mobile Viewport (375x812)
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 });
  await mobilePage.waitForTimeout(2000);

  const mobilePath = path.join(artifactDir, `live_mobile_${Date.now()}.png`);
  await mobilePage.screenshot({ path: mobilePath, fullPage: false });
  console.log(`[Audit] Captured Mobile Screenshot: ${mobilePath}`);

  await mobileContext.close();
  await browser.close();

  console.log(`[Audit] Audit Complete!`);
}

auditLive().catch(err => {
  console.error(`[Audit] Error:`, err);
  process.exit(1);
});
