import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import * as cheerio from "cheerio"; 
import * as readline from "readline";

const SEARCH_URL = "https://www.naukri.com/cxo-jobs?k=cxo";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query: string): Promise<string> {
    return new Promise(resolve => rl.question(query, resolve));
}

async function runSupervised() {
  console.log('Starting Supervised Naukri Scrape in Headful Mode...');
  
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

  try {
      console.log("Navigating to search page:", SEARCH_URL);
      await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      console.log("\n*** BROWSER IS OPEN ***");
      console.log("Please log in to Naukri in the browser window.");
      
      console.log("\n*** MANUAL INTERVENTION REQUIRED ***");
      console.log("Because Naukri is blocking the API that loads jobs when logged in via Playwright...");
      console.log("Please manually click on any CXO job from the search results.");
      console.log("Wait for it to open in a NEW TAB.");
      
      await askQuestion("Press ENTER in this terminal once you have clicked a job and the Job Description page is fully loaded in the NEW TAB: ");

      console.log("Finding the new tab with the job description...");
      const allPages = context.pages();
      
      let jdPage = page;
      if (allPages.length > 1) {
          jdPage = allPages[allPages.length - 1]; // Grab the most recently opened tab
          await jdPage.bringToFront();
          console.log("Switched context to new tab: ", jdPage.url());
      } else {
          console.log("No new tab found, extracting from original tab...");
      }

      console.log("Extracting Job Description from current active page...");

      let jdHtml = null;
      let selectorSucceeded = "";

      console.log("Attempting extraction via __NEXT_DATA__ JSON payload first...");
      const nextDataText = await jdPage.evaluate(() => {
          const el = document.querySelector('#__NEXT_DATA__');
          return el ? el.innerHTML : null;
      });

      if (nextDataText) {
           try {
              const nextData = JSON.parse(nextDataText);
              if (nextData && nextData.props && nextData.props.pageProps && nextData.props.pageProps.jobDetails && nextData.props.pageProps.jobDetails.jobDescription) {
                  jdHtml = nextData.props.pageProps.jobDetails.jobDescription;
                  selectorSucceeded = "#__NEXT_DATA__ -> jobDescription";
                  console.log("Successfully found un-truncated JD inside Next.js state!");
              }
           } catch(e) {
               console.log("Failed to parse __NEXT_DATA__");
           }
      }

      if (!jdHtml) {
          console.log("Falling back to DOM extraction...");
          const htmlContent = await jdPage.content();
          const cheerioApi = cheerio.load(htmlContent);
          
          const primaryContainers = [
              "[class*='styles_job-desc-container']",
              "section[class*='job-desc']",
              "div.styles_JDSummary",
              "[class*='jobDescription']",
              "#job-description",
              ".dang-inner-html",
              "[class*='dang-inner-html']",
              ".job-description",          
              "div[class*='job-description']",
              ".styles_JDContainer__",
              "[class*='JDContainer']" 
          ];
          
          for (let i = 0; i < primaryContainers.length; i++) {
              const sel = primaryContainers[i];
              const elements = cheerioApi(sel);
              if (elements.length > 0) {
                  const txt = elements.first().text().trim();
                  if (txt.length >= 150) {
                      jdHtml = elements.first().html();
                      selectorSucceeded = sel;
                      break;
                  }
              }
          }

          if (!jdHtml) {
              console.log("Trying desperate DOM header search...");
              const headers = cheerioApi('h2, h3, h4').filter((i, el) => {
                  return cheerioApi(el).text().toLowerCase().includes('job description') || cheerioApi(el).text().toLowerCase().includes('job responsibilities');
              });
              if (headers.length > 0) {
                  const parent = headers.first().parent();
                  if (parent.text().length > 200) {
                      jdHtml = parent.html();
                      selectorSucceeded = "Header Sibling Fallback";
                  }
              }
          }

          if (!jdHtml) {
               console.log("Desperate logged-in DOM check...");
               const contentNode = await jdPage.evaluate(() => {
                   const nodes = Array.from(document.querySelectorAll('*'));
                   for (let i = 0; i < nodes.length; i++) {
                       const textContent = nodes[i].textContent;
                       if (textContent && textContent.trim().toLowerCase() === 'job description') {
                           let parent = nodes[i].parentElement;
                           if (parent && parent.innerText.length > 200) {
                               return parent.innerHTML;
                           }
                       }
                   }
                   return null;
               });
               if (contentNode) {
                   jdHtml = contentNode;
                   selectorSucceeded = "Desperate innerText search";
               }
          }
      }
      
      if (jdHtml) {
          console.log("Successfully extracted JD HTML using selector:", selectorSucceeded);
          const jdDom = cheerio.load(jdHtml);
          
          jdDom('br, p, div, li, h1, h2, h3, h4, h5, h6').append('\\n');
          
          let rawText = jdDom.text();
          rawText = rawText.replace(/[ \t]+/g, " ").replace(/\\n\\s*\\n/g, "\\n").trim();
          
          console.log("Extracted Text Length:", rawText.length);
          console.log("--- JD PREVIEW ---");
          console.log(rawText + "\\n");
      } else {
          console.log("Failed to extract JD using any method. Dumping HTML to JD_debug_manual.html");
          const content = await jdPage.content();
          
      }

      console.log("Looking for an 'Apply' or External link... ");
      const applyUrl = await jdPage.evaluate(() => {
         const csite = document.querySelector('.styles_jhc-company-site__, .styles_jhc-apply-button__, #company-site-button');
         if (csite && csite.tagName.toLowerCase() === 'a') return (csite as HTMLAnchorElement).href;
         
         const links = Array.from(document.querySelectorAll('a, button'));
         for (let i = 0; i < links.length; i++) {
             const l = links[i];
             const text = (l.textContent || '').trim().toLowerCase();
             if (text.includes('apply') || text.includes('company site') || l.id.toLowerCase().includes('apply') || l.className.toLowerCase().includes('apply')) {
                 if (l.tagName.toLowerCase() === 'a') {
                     return (l as HTMLAnchorElement).href;
                 }
             }
         }
         return null;
      });
      
      if (applyUrl) {
          console.log("Found Apply Link pointing to:", applyUrl);
      } else {
          console.log("No external apply link found.");
      }

      console.log("Experiment complete. Closing in 10 seconds...");
      await jdPage.waitForTimeout(10000);
      
  } catch (err: any) {
      console.error("Supervised experiment error:", err.message);
  } finally {
      console.log("Closing browser.");
      await browser.close();
      rl.close();
  }
}

runSupervised().catch(console.error);
