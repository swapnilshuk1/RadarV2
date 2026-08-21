import fs from "fs";
import path from "path";
import { Page } from "playwright";
import { ARTIFACTS_DIR } from "../config";

/**
 * Sanitizes arbitrary diagnostic strings (errors, titles, URLs, HTML) to ensure
 * secrets, tokens, cookies, or auth envelopes are not leaked to disk or logs.
 *
 * Diagnostic Confidentiality Boundary:
 * - Textual artifacts (url.txt, title.txt, error.txt, page.html): Known credential patterns,
 *   tokens, and session identifiers are sanitized via regex substitution.
 * - Bitmap artifacts (page.png): Diagnostic screenshots are raw browser viewport renders
 *   and are explicitly unredacted diagnostic bitmaps not guaranteed secret-free.
 */
export function sanitizeDiagnosticValue(input: unknown): string {
  if (input === null || input === undefined) return "";
  let str = typeof input === "string" ? input : String(input);

  // Redact Bearer / Basic tokens
  str = str.replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, "Bearer [REDACTED]");
  str = str.replace(/Basic\s+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]");

  // Redact URL query parameter tokens (?token=..., &apiKey=..., &li_at=...)
  str = str.replace(/([?&](?:li_at|JSESSIONID|session|auth|token|jwt|apiKey|password|secretPayload|secret)=)[^&\s]+/gi, "$1[REDACTED]");

  // Redact sensitive cookies and key-values (li_at, JSESSIONID, auth tokens, secretPayload)
  str = str.replace(/\b(?:li_at|JSESSIONID|session|auth|token|jwt|apiKey|password|secretPayload|secret)\b\s*[:=]\s*[^\r\n,;]+/gi, (match) => {
    const eqIdx = match.search(/[:=]/);
    const key = match.slice(0, eqIdx + 1);
    return `${key} [REDACTED]`;
  });

  // Redact header lines
  str = str.replace(/(?:authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/gi, (match) => {
    const colonIdx = match.indexOf(":");
    return `${match.slice(0, colonIdx + 1)} [REDACTED]`;
  });

  // Redact JSON fields with flexible whitespace
  str = str.replace(/"(secretPayload|encryptedCiphertext|iv|authTag|token|password|secret|li_at|JSESSIONID)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"');

  return str;
}

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

    const url = page ? page.url() : "";
    fs.writeFileSync(urlPath, sanitizeDiagnosticValue(url), "utf8");

    const title = page ? await page.title().catch(() => "Unknown Title") : "Unknown Title";
    fs.writeFileSync(titlePath, sanitizeDiagnosticValue(title), "utf8");

    fs.writeFileSync(errorPath, sanitizeDiagnosticValue(errorMsg), "utf8");

    const html = page ? await page.content().catch(() => "Failed to get content") : "No Page Content";
    fs.writeFileSync(htmlPath, sanitizeDiagnosticValue(html), "utf8");

    if (page) {
      await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {});
    }

    console.log(`[scrape:${portal}] Failure artifacts dumped to ${dir}`);
  } catch (err: any) {
    console.error(`[scrape:${portal}] Failed to dump failure artifacts: ${sanitizeDiagnosticValue(err.message)}`);
  }
}
