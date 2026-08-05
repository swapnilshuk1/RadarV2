import { chromium } from 'playwright';
import path from 'path';

async function auditFullDossierPage() {
  const browser = await chromium.launch({ headless: true });
  const artifactDir = 'C:/Users/swapn/.gemini/antigravity/brain/ce7d2ebc-8990-4629-8871-46c6504603ff';

  // 1. Desktop Full Dossier Page
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

  console.log('Navigating Desktop to Shortlist Page...');
  await desktopPage.goto('http://130.210.41.232.sslip.io/', { waitUntil: 'networkidle' });
  
  // Expand first card
  const cardTitle = desktopPage.locator('button:has-text("+"), h3, h2').first();
  if (await cardTitle.isVisible()) {
    console.log('Expanding first shortlist card...');
    await cardTitle.click();
    await desktopPage.waitForTimeout(1000);

    // Click OPEN FULL DOSSIER button
    const openDossierBtn = desktopPage.locator('text=OPEN FULL DOSSIER').first();
    if (await openDossierBtn.isVisible()) {
      console.log('Clicking OPEN FULL DOSSIER button...');
      await openDossierBtn.click();
      await desktopPage.waitForLoadState('networkidle');
      await desktopPage.waitForTimeout(2000);
    }
  }

  const fullDossierDesktopPath = path.join(artifactDir, 'art_director_full_dossier_desktop.png');
  await desktopPage.screenshot({ path: fullDossierDesktopPath, fullPage: true });
  console.log(`Saved Desktop Full Dossier screenshot: ${fullDossierDesktopPath}`);

  // 2. Mobile Full Dossier Page
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

  console.log('Navigating Mobile to Shortlist Page...');
  await mobilePage.goto('http://130.210.41.232.sslip.io/', { waitUntil: 'networkidle' });
  const mobileCard = mobilePage.locator('button:has-text("+"), h3, h2').first();
  if (await mobileCard.isVisible()) {
    await mobileCard.click();
    await mobilePage.waitForTimeout(1000);

    const openDossierMobileBtn = mobilePage.locator('text=OPEN FULL DOSSIER').first();
    if (await openDossierMobileBtn.isVisible()) {
      console.log('Clicking OPEN FULL DOSSIER button on Mobile...');
      await openDossierMobileBtn.click();
      await mobilePage.waitForLoadState('networkidle');
      await mobilePage.waitForTimeout(2000);
    }
  }

  const fullDossierMobilePath = path.join(artifactDir, 'art_director_full_dossier_mobile.png');
  await mobilePage.screenshot({ path: fullDossierMobilePath, fullPage: true });
  console.log(`Saved Mobile Full Dossier screenshot: ${fullDossierMobilePath}`);

  // Check mobile overflow on Full Dossier
  const mobileDossierOverflow = await mobilePage.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  console.log(`Full Dossier Mobile horizontal overflow: ${mobileDossierOverflow}`);

  await browser.close();
  console.log('--- Full Dossier Audit Complete ---');
}

auditFullDossierPage().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
