import fs from "fs";
import path from "path";
import { Page } from "playwright";
import { ARTIFACTS_DIR } from "../config";

export async function dumpFailureArtifacts(
  runId: string,
  portal: string,
  page: Page,
  errorMsg: string
) {
  try {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const dir = path.join(ARTIFACTS_DIR, "failures", today, runId, portal.toLowerCase());
    fs.mkdirSync(dir, { recursive: true });

    const timestamp = Date.now();
    const prefix = `${timestamp}-`;

    const htmlPath = path.join(dir, `${prefix}page.html`);
    const pngPath = path.join(dir, `${prefix}page.png`);
    const urlPath = path.join(dir, `${prefix}url.txt`);
    const titlePath = path.join(dir, `${prefix}title.txt`);
    const errorPath = path.join(dir, `${prefix}error.txt`);

    const url = page.url();
    fs.writeFileSync(urlPath, url, "utf8");

    const title = await page.title().catch(() => "Unknown Title");
    fs.writeFileSync(titlePath, title, "utf8");

    fs.writeFileSync(errorPath, errorMsg, "utf8");

    const html = await page.content().catch(() => "Failed to get content");
    fs.writeFileSync(htmlPath, html, "utf8");

    await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {});

    console.log(`[scrape:${portal}] Failure artifacts dumped to ${dir}`);
  } catch (err: any) {
    console.error(`[scrape:${portal}] Failed to dump failure artifacts: ${err.message}`);
  }
}
