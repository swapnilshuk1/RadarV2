import { chromium } from 'playwright';
import path from 'path';

async function auditDossierPage() {
  const browser = await chromium.launch({ headless: true });
  const artifactDir = 'C:/Users/swapn/.gemini/antigravity/brain/ce7d2ebc-8990-4629-8871-46c6504603ff';

  // Desktop Dossier
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto('http://130.210.41.232.sslip.io/login', { waitUntil: 'networkidle' });
  await desktopPage.evaluate(() => {
    sessionStorage.setItem('radar_session', JSON.stringify({
      userId: 'swapnil-shukla-dev',
      name: 'Swapnil Shukla',
      onboarded: true
    }));
  });

  // Navigate to first job hash opportunity detail
  console.log('Navigating Desktop to Opportunity Dossier page...');
  await desktopPage.goto('http://130.210.41.232.sslip.io/', { waitUntil: 'networkidle' });
  
  // Click first card title or expand button
  const cardTitle = desktopPage.locator('button:has-text("+"), h3, h2').first();
  if (await cardTitle.isVisible()) {
    console.log('Clicking card element on shortlist...');
    await cardTitle.click();
    await desktopPage.waitForTimeout(1000);
  }

  const desktopDossierPath = path.join(artifactDir, 'art_director_dossier_desktop.png');
  await desktopPage.screenshot({ path: desktopDossierPath, fullPage: true });
  console.log(`Saved Desktop Dossier screenshot: ${desktopDossierPath}`);

  // Mobile Dossier
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

  console.log('Navigating Mobile to Opportunity Dossier page...');
  await mobilePage.goto('http://130.210.41.232.sslip.io/', { waitUntil: 'networkidle' });
  const mobileCard = mobilePage.locator('button:has-text("+"), h3, h2').first();
  if (await mobileCard.isVisible()) {
    await mobileCard.click();
    await mobilePage.waitForTimeout(1000);
  }

  const mobileDossierPath = path.join(artifactDir, 'art_director_dossier_mobile.png');
  await mobilePage.screenshot({ path: mobileDossierPath, fullPage: true });
  console.log(`Saved Mobile Dossier screenshot: ${mobileDossierPath}`);

  await browser.close();
  console.log('--- Dossier Audit Complete ---');
}

auditDossierPage().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
