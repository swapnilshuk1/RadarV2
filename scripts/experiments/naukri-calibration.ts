import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { ResponseValidator } from "../../src/lib/acquisition/validator";
import fs from "fs";
import path from "path";
import * as cheerio from "cheerio"; 

const TEST_URL = "https://www.naukri.com/job-listings-program-manager-2-zscaler-bengaluru-4-to-9-years-210824502598";

async function runExperiment() {
  console.log('Starting Naukri Calibration Experiment (Playwright Stealth + Intercept) for URL:', TEST_URL);
  
  const diagnostic = {
    originalUrl: TEST_URL,
    finalUrl: TEST_URL,
    redirectChain: [] as string[],
    pageTitle: "",
    hydrationCondition: "Intercepting API response directly",
    selectorsAttempted: [] as string[],
    selectorSucceeded: "",
    rawHtmlLength: 0,
    extractedTextLength: 0,
    wordCount: 0,
    validatorResult: null as any,
    failureClassification: null as any,
  };

  chromium.use(stealth());
  
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 768 }
  });
  
  const page = await context.newPage();

  let jdHtml = null;

  // Intercept the NextJS data payload or API requests
  page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('jobapi/v3/job/') || url.includes('/jobapi/v4/job/')) {
          console.log("Found job API response:", url);
          try {
              const data = await response.json();
              if (data && data.jobDetails && data.jobDetails.jobDescription) {
                  jdHtml = data.jobDetails.jobDescription;
                  console.log("Successfully extracted JD from API intercept!");
              }
          } catch(e) {
              // Ignore
          }
      }
  });
  
  page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
          diagnostic.redirectChain.push(frame.url());
      }
  });

  try {
      await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Wait a moment for any APIs to settle
      await page.waitForTimeout(3000);

      diagnostic.finalUrl = page.url();
      diagnostic.pageTitle = await page.title();
      
      console.log("Final URL:", diagnostic.finalUrl);
      console.log("Redirect Chain:", diagnostic.redirectChain);

      if (!jdHtml) {
          // If we didn't get it from intercept, check NEXT_DATA
          const nextDataText = await page.evaluate(() => {
              const el = document.querySelector('#__NEXT_DATA__');
              return el ? el.innerHTML : null;
          });

          if (nextDataText) {
               try {
                  const nextData = JSON.parse(nextDataText);
                  if (nextData && nextData.props && nextData.props.pageProps && nextData.props.pageProps.jobDetails) {
                      jdHtml = nextData.props.pageProps.jobDetails.jobDescription;
                      console.log("Extracted JD from __NEXT_DATA__ script payload");
                      diagnostic.selectorSucceeded = "#__NEXT_DATA__ -> jobDescription";
                  }
               } catch(e) {}
          }
      }

      if (!jdHtml) {
          // Fallback to DOM static extraction
           const primaryContainers = [
              "[class*='styles_job-desc-container']",
              "section[class*='job-desc']",
              "div.styles_JDSummary",
              "[class*='jobDescription']",
              "#job-description",
              ".dang-inner-html",
              "[class*='dang-inner-html']"
            ];
            
            for (const sel of primaryContainers) {
                diagnostic.selectorsAttempted.push(sel);
                const html = await page.evaluate((s) => {
                    const el = document.querySelector(s);
                    return el ? el.innerHTML : null;
                }, sel);
                
                if (html) {
                    jdHtml = html;
                    diagnostic.selectorSucceeded = sel;
                    console.log("Extracted JD from DOM selector:", sel);
                    break;
                }
            }
      }

      if (!jdHtml) {
          throw new Error("Could not extract JD HTML from intercept, NEXT_DATA, or DOM.");
      }
      
      const jdDom = cheerio.load(jdHtml);
      const rawText = jdDom.text().replace(/\s+/g, " ").trim();
      
      diagnostic.extractedTextLength = rawText.length;
      diagnostic.wordCount = rawText.split(/\s+/).length;

      console.log("Validating extraction...");
      const valResult = ResponseValidator.validate({
          html: jdHtml, 
          url: diagnostic.finalUrl,
          sourcePortal: "Naukri",
          extractedDescription: rawText
      });

      diagnostic.validatorResult = valResult;
      diagnostic.failureClassification = valResult.failureClass || null;

      const artifactsDir = path.join(process.cwd(), "scripts", "experiments", "artifacts");
      if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
      
      const timestamp = Date.now();
      const htmlPath = path.join(artifactsDir, "naukri-calibration-" + timestamp + ".html");
      const jsonPath = path.join(artifactsDir, "naukri-calibration-" + timestamp + ".json");
      
      fs.writeFileSync(htmlPath, jdHtml);
      fs.writeFileSync(jsonPath, JSON.stringify(diagnostic, null, 2));
      
      // Capture screenshot
      const screenshotPath = path.join(artifactsDir, "naukri-calibration-" + timestamp + ".png");
      await page.screenshot({ path: screenshotPath, fullPage: true });

      console.log("\n--- Diagnostic Trace ---");
      console.log(JSON.stringify(diagnostic, null, 2));
      console.log('\nArtifacts saved to:', artifactsDir);
      
  } catch (err: any) {
      console.error("Experiment Failed:", err.message);
      
      diagnostic.failureClassification = "EXPERIMENT_ERROR";
      
      const artifactsDir = path.join(process.cwd(), "scripts", "experiments", "artifacts");
      if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
      
      const timestamp = Date.now();
      const jsonPath = path.join(artifactsDir, "naukri-calibration-error-" + timestamp + ".json");
      
      fs.writeFileSync(jsonPath, JSON.stringify(diagnostic, null, 2));
      
      console.log(JSON.stringify(diagnostic, null, 2));
      console.log('\nError Artifacts saved to:', artifactsDir);

  } finally {
      await browser.close();
  }
}

runExperiment().catch(console.error);
