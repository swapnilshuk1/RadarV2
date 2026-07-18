import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`PAGE ERROR: ${msg.text()}`);
    }
  });
  
  page.on('pageerror', error => {
    console.log(`PAGE EXCEPTION: ${error.message}`);
  });

  await page.goto("http://localhost:8080/opportunity/j-07873ec4648e");
  await page.waitForTimeout(2000);
  await browser.close();
}

main();
