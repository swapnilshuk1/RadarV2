import { chromium } from 'playwright';

async function triggerRemoteDeploy() {
  console.log('Launching browser to trigger Oracle deployment...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('SERVER/PAGE LOG:', msg.text()));

  console.log('Navigating to http://130.210.41.232.sslip.io/login...');
  await page.goto('http://130.210.41.232.sslip.io/login', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    sessionStorage.setItem('radar_session', JSON.stringify({
      userId: 'swapnil-shukla-dev',
      name: 'Swapnil Shukla',
      onboarded: true
    }));
    document.cookie = "radar_session=swapnil-shukla-dev; path=/";
  });

  console.log('Navigating to http://130.210.41.232.sslip.io/profile...');
  await page.goto('http://130.210.41.232.sslip.io/profile', { waitUntil: 'networkidle' });

  console.log('Looking for SYNC & REBUILD button...');
  const syncBtn = page.locator('button:has-text("SYNC & REBUILD")');
  if (await syncBtn.isVisible()) {
    console.log('Found SYNC & REBUILD button, clicking now...');
    page.on('dialog', async dialog => {
      console.log('ALERT DIALOG:', dialog.message());
      await dialog.accept();
    });
    await syncBtn.click();
    console.log('Clicked! Waiting 15 seconds for git pull and build on server...');
    await page.waitForTimeout(15000);
    console.log('Deployment trigger sequence completed.');
  } else {
    console.error('SYNC & REBUILD button not visible on profile page.');
    console.log('Page content snippet:', (await page.content()).slice(0, 500));
  }

  await browser.close();
}

triggerRemoteDeploy().catch(err => {
  console.error('Failed to trigger remote deployment:', err);
  process.exit(1);
});
