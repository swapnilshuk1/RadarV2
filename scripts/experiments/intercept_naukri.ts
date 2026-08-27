import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";

chromium.use(stealth());

async function run() {
    console.log("Launching browser with your active scraper profile...");
    
    const userDataDir = "C:\\Users\\swapn\\Downloads\\radar-local-v2\\.scraper-artifacts\\profiles\\naukri-primary"; // Adjust if different
    
    // Fallback dir if standard not present
    let finalDir = userDataDir;
    if (!fs.existsSync(finalDir)) finalDir = "C:\\Users\\swapn\\Downloads\\radar-local-v2\\.scraper-cache\\profiles\\naukri-primary";
    
    const browser = await chromium.launchPersistentContext(finalDir, { 
        headless: false,
        viewport: { width: 1280, height: 800 }
    });
    
    const page = await browser.newPage();
    
    const endpoints = new Set<string>();
    let foundApi = false;
    
    page.on('response', async (response) => {
        const url = response.url();
        const request = response.request();
        if (request.method() === 'GET' || request.method() === 'POST') {
            // Naukri API for jobs
            if (url.includes('graphql') || url.includes('api') || url.includes('search')) {
                const contentType = response.headers()['content-type'] || '';
                if (contentType.includes('application/json')) {
                    try {
                        const json = await response.json();
                        endpoints.add(url);
                        if (JSON.stringify(json).includes("Group CFO") || JSON.stringify(json).includes("jobId")) {
                            foundApi = true;
                            fs.writeFileSync(`naukri_api_hit.json`, JSON.stringify({url, method: request.method(), body: json}, null, 2));
                            console.log(`\n>>> SUCCESS! Found Job API response from: ${url} <<<\n`);
                        }
                    } catch(e) {
                        // ignore
                    }
                }
            }
        }
    });

    console.log("Navigating to Naukri...");
    await page.goto("https://www.naukri.com/cxo-jobs?k=cxo");
    
    console.log("Waiting 15 seconds to let jobs load...");
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    console.log("Done capturing. Found endpoints:");
    endpoints.forEach(e => console.log(" -", e));
    
    if (foundApi) {
        console.log("\nAPI Payload successfully saved to naukri_api_hit.json");
    }
    
    await browser.close();
}

run().catch(console.error);
