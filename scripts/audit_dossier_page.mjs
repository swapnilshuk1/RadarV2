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
  desktopPage.on('console', msg => console.log('DESKTOP CONSOLE:', msg.text()));
  desktopPage.on('pageerror', err => console.log('DESKTOP PAGE ERROR:', err.message));
  await desktopPage.goto('http://localhost:3001/login', { waitUntil: 'networkidle' });
  await desktopPage.evaluate(() => {
    sessionStorage.setItem('radar_session', JSON.stringify({
      userId: 'swapnil-shukla-dev',
      name: 'Swapnil Shukla',
      onboarded: true
    }));
  });

  // Navigate to first job hash opportunity detail
  console.log('Navigating Desktop to Opportunity Dossier page...');
  await desktopPage.goto('http://localhost:3001/', { waitUntil: 'networkidle' });
  
  // Find the first list item button containing "+ BRIEF" and click it to expand the drawer
  const expandBtn = desktopPage.locator('button:has-text("+ BRIEF"), button:has-text("+ Brief")').first();
  console.log('Expanding first desktop brief row...');
  await expandBtn.click({ timeout: 10000 });

  // Now find the link containing "/opportunity/" and click it
  const dossierLink = desktopPage.locator('a[href*="/opportunity/"]').first();
  console.log('Navigating to Desktop Dossier...');
  await dossierLink.click({ timeout: 10000 });
  await desktopPage.waitForURL('**/opportunity/**', { timeout: 15000 });
  await desktopPage.waitForLoadState('networkidle');

  console.log('Current Desktop URL:', desktopPage.url());
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
  mobilePage.on('console', msg => console.log('MOBILE CONSOLE:', msg.text()));
  mobilePage.on('pageerror', err => console.log('MOBILE PAGE ERROR:', err.message));
  await mobilePage.goto('http://localhost:3001/login', { waitUntil: 'networkidle' });
  await mobilePage.evaluate(() => {
    sessionStorage.setItem('radar_session', JSON.stringify({
      userId: 'swapnil-shukla-dev',
      name: 'Swapnil Shukla',
      onboarded: true
    }));
  });

  console.log('Navigating Mobile to Opportunity Dossier page...');
  await mobilePage.goto('http://localhost:3001/', { waitUntil: 'networkidle' });
  // Find the first list item button containing "+ BRIEF" and click it to expand the drawer on mobile
  const mobileExpandBtn = mobilePage.locator('button:has-text("+ BRIEF"), button:has-text("+ Brief")').first();
  console.log('Expanding first mobile brief row...');
  await mobileExpandBtn.click({ timeout: 10000 });

  const mobileDossierLink = mobilePage.locator('a[href*="/opportunity/"]').first();
  console.log('Navigating to Mobile Dossier...');
  await mobileDossierLink.click({ timeout: 10000 });
  await mobilePage.waitForURL('**/opportunity/**', { timeout: 15000 });
  await mobilePage.waitForLoadState('networkidle');

  console.log('Current Mobile URL:', mobilePage.url());
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
