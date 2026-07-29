import { createServer } from "vite";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

async function runQA() {
  console.log("=== RADAR SHORTLIST INTERACTIVE QA ===");
  
  // 1. Start the Vite dev server programmatically
  console.log("\n[1/5] Starting programmatic Vite dev server...");
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: {
      port: 5173,
    },
  });
  await server.listen();
  console.log("Vite dev server is listening on http://localhost:5173/");

  // 2. Launch headless browser
  console.log("\n[2/5] Launching Playwright Chromium instance...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture client-side logs and errors
  const pageLogs: string[] = [];
  page.on("console", (msg) => {
    pageLogs.push(`[Console][${msg.type()}] ${msg.text()}`);
    console.log(`  [Browser Console] ${msg.text()}`);
  });
  
  page.on("pageerror", (err) => {
    pageLogs.push(`[Error] ${err.message}`);
    console.error(`  [Browser JS Error] ${err.stack}`);
  });

  // 3. Navigate to Shortlist Dashboard
  console.log("\n[3/5] Navigating to http://localhost:5173/ ...");
  await page.goto("http://localhost:5173/");
  
  // Wait for React to mount and opportunities to load
  await page.waitForTimeout(3000);

  // Check initial shortlist rendering
  const initialHtml = await page.content();
  const listItemsCount = await page.locator("ul > li").count();
  console.log(`Shortlist rendered. Found ${listItemsCount} active shortlist item rows.`);

  if (listItemsCount === 0) {
    console.error("No opportunities found on shortlist. Please check that mock database or live-scraped.json is seeded.");
    await browser.close();
    await server.close();
    return;
  }

  // 4. Click the first position row to trigger onToggle
  console.log("\n[4/5] Testing row expansion click...");
  
  // Find the button inside the first li item
  const firstRowButton = page.locator("ul > li").first().locator("button[type='button']");
  const roleName = await firstRowButton.locator("span.truncate").first().innerText();
  const companyName = await firstRowButton.locator("span.text-\\[13px\\]").first().innerText();
  console.log(`Target row identified: "${roleName}" at ${companyName}`);

  // Measure if brief panel is visible BEFORE click
  const beforeClickIsVisible = await page.locator("div.animate-fade-in").isVisible();
  console.log(`Is brief panel visible before clicking? ${beforeClickIsVisible ? "YES" : "NO (Expected)"}`);

  // Perform the click!
  console.log("Clicking toggle button...");
  await firstRowButton.click();
  
  // Wait for click event processing and state update
  await page.waitForTimeout(1000);

  // Measure if brief panel is visible AFTER click
  const afterClickIsVisible = await page.locator("div.animate-fade-in").isVisible();
  console.log(`Is brief panel visible after clicking? ${afterClickIsVisible ? "YES (Success)" : "NO (Failure)"}`);

  // Fetch some parsed text inside the InlineBrief to verify content rendering
  let matchedCertaintyText = "";
  if (afterClickIsVisible) {
    matchedCertaintyText = await page.locator("div.animate-fade-in").first().innerText();
    console.log("Inner Brief content successfully mounted in DOM! Context preview:");
    console.log(matchedCertaintyText.split("\n").slice(0, 4).map(l => `  > ${l}`).join("\n"));
  }

  // 5. Cleanup
  console.log("\n[5/5] Cleaning up processes...");
  await browser.close();
  await server.close();
  console.log("Vite dev server stopped successfully.");

  // 6. Write Markdown QA Report
  const auditPath = "C:\\Users\\swapn\\.gemini\\antigravity\\brain\\98fc6af1-d28e-448d-bb5d-eae7cc7b6f67\\qa_audit_results.md";
  const success = afterClickIsVisible && !beforeClickIsVisible;
  
  const report = `# Shortlist Dashboard QA Audit Report
Timestamp: ${new Date().toISOString()}
Status: ${success ? "✅ PASSED" : "❌ FAILED"}

## Executive Summary
This automated QA audit programmatically spins up a local Vite development server, launches a headless Chromium instance, performs user-like tap actions on the Shortlist Dashboard, and checks the DOM and console streams for errors or exceptions.

## Test Results
- **Active rows discovered**: ${listItemsCount}
- **Target position clicked**: "${roleName}" at ${companyName}
- **Panel visibility before click**: ${beforeClickIsVisible ? "Visible (Unexpected)" : "Collapsed (Correct)"}
- **Panel visibility after click**: ${afterClickIsVisible ? "Visible (Correct)" : "Collapsed (Unexpected)"}
- **DOM Integration status**: ${success ? "100% Correct. React state updated and mounted InlineBrief flawlessly." : "Failed to toggle or mount Brief panel."}

## Console and JS Log Stream
\`\`\`text
${pageLogs.length > 0 ? pageLogs.join("\n") : "No errors or console logs emitted. Complete silent execution."}
\`\`\`

---
*Verified by Antigravity Core QA Suite.*
`;

  fs.writeFileSync(auditPath, report, "utf-8");
  console.log(`\nQA Audit Report successfully saved to: ${auditPath}`);
}

runQA().catch((err) => {
  console.error("QA Test Script failed with exception:", err);
});
