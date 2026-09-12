import { chromium } from 'playwright';
import path from 'path';

async function auditShortlistAndDossier() {
  const browser = await chromium.launch({ headless: true });
  const artifactDir = 'C:/Users/swapn/.gemini/antigravity/brain/ce7d2ebc-8990-4629-8871-46c6504603ff';

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  // 1. Set authenticated session state in sessionStorage before navigation
  console.log('--- Setting session state for authenticated audit ---');
  await page.goto('http://130.210.41.232.sslip.io/login', { waitUntil: 'networkidle' });
  
  await page.evaluate(() => {
    const sessionData = {
      userId: 'swapnil-shukla-dev',
      email: 'swapnil@radar.advisory',
      name: 'Swapnil Shukla',
      avatarUrl: 'https://lh3.googleusercontent.com/a/default-user=s100',
      onboarded: true
    };
    sessionStorage.setItem('radar_session', JSON.stringify(sessionData));
  });

  // 2. Audit Shortlist Page (Desktop)
  console.log('Navigating Desktop to Shortlist Page (/) ...');
  await page.goto('http://130.210.41.232.sslip.io/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const desktopShortlistPath = path.join(artifactDir, 'art_director_shortlist_desktop.png');
  await page.screenshot({ path: desktopShortlistPath, fullPage: true });
  console.log(`Saved Desktop Shortlist screenshot: ${desktopShortlistPath}`);

  // 3. Audit Shortlist Page (Mobile 375px)
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto('http://130.210.41.232.sslip.io/login', { waitUntil: 'networkidle' });
  await mobilePage.evaluate(() => {
    sessionStorage.setItem('radar_session', JSON.stringify({
      userId: 'swapnil-shukla-dev',
      name: 'Swapnil Shukla',
      onboarded: true
    }));
  });

  console.log('Navigating Mobile to Shortlist Page (/) ...');
  await mobilePage.goto('http://130.210.41.232.sslip.io/', { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(2000);

  const mobileShortlistPath = path.join(artifactDir, 'art_director_shortlist_mobile.png');
  await mobilePage.screenshot({ path: mobileShortlistPath, fullPage: true });
  console.log(`Saved Mobile Shortlist screenshot: ${mobileShortlistPath}`);

  // 4. Find first opportunity dossier link and navigate to Dossier page
  console.log('Navigating to Dossier / Opportunity Detail Page ...');
  const firstCardLink = page.locator('a[href^="/opportunity/"]').first();
  if (await firstCardLink.isVisible()) {
    const href = await firstCardLink.getAttribute('href');
    console.log(`Opening Dossier link: ${href}`);
    await page.goto(`http://130.210.41.232.sslip.io${href}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const desktopDossierPath = path.join(artifactDir, 'art_director_dossier_desktop.png');
    await page.screenshot({ path: desktopDossierPath, fullPage: true });
    console.log(`Saved Desktop Dossier screenshot: ${desktopDossierPath}`);

    // Mobile Dossier
    await mobilePage.goto(`http://130.210.41.232.sslip.io${href}`, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(2000);
    const mobileDossierPath = path.join(artifactDir, 'art_director_dossier_mobile.png');
    await mobilePage.screenshot({ path: mobileDossierPath, fullPage: true });
    console.log(`Saved Mobile Dossier screenshot: ${mobileDossierPath}`);
  } else {
    console.warn('No dossier link found on shortlist page!');
  }

  await browser.close();
  console.log('--- Shortlist & Dossier Art Director Audit Complete ---');
}

auditShortlistAndDossier().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
