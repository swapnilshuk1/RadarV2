import { request, Agent } from "undici";
import * as cheerio from "cheerio";

// Global keep-alive agent to reuse TLS handshakes across concurrent detail requests.
const agent = new Agent({
  keepAliveTimeout: 10,
  keepAliveMaxTimeout: 10,
  connections: 50,
});

export interface HttpFetchResult {
  fetched: boolean;
  rawHtml?: string;
  rawText?: string;
  fetchError?: string;
  fetchDurationMs?: number;
  httpStatus?: number;
}

/**
 * Executes a lightweight HTTP fetch with Undici and parses it with Cheerio.
 * @param url The detail URL to fetch
 * @param requiredSelector A CSS selector that MUST exist for the fetch to be considered successful
 * @param textSelector A CSS selector for extracting the raw text (e.g., job description)
 */
export async function fastFetchDetail(
  url: string,
  requiredSelector: string,
  textSelector: string,
  customHeaders?: Record<string, string>
): Promise<HttpFetchResult> {
  const t0 = Date.now();
  let attempts = 0;
  
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    ...(customHeaders || {})
  };

  while (attempts < 3) {
    attempts++;
    try {
      const { statusCode, body } = await request(url, {
        dispatcher: agent,
        headers,
      });

      if (statusCode === 429 || statusCode >= 500) {
        if (attempts < 3) {
          await new Promise((r) => setTimeout(r, (attempts * 1000) + Math.random() * 500));
          continue;
        }
      }

      if (statusCode < 200 || statusCode >= 400) {
        return { fetched: false, fetchError: `HTTP ${statusCode}`, fetchDurationMs: Date.now() - t0, httpStatus: statusCode };
      }

      const html = await body.text();
      const $ = cheerio.load(html);

      const requiredElement = $(requiredSelector);
      if (!requiredElement.length) {
        return { fetched: false, fetchError: `Required selector "${requiredSelector}" not found (Auth wall / Captcha)`, fetchDurationMs: Date.now() - t0, httpStatus: statusCode };
      }

      const textElement = $(textSelector);
      if (!textElement.length) {
        return { fetched: false, fetchError: `Text selector "${textSelector}" not found`, fetchDurationMs: Date.now() - t0 };
      }

      // Clean up whitespace like the Playwright fallback does
      const rawText = textElement.text().replace(/\s+/g, " ").trim();
      
      // Hard validation (must have some meaningful length to count as success)
      if (rawText.length < 500) {
        return { fetched: false, fetchError: `Extracted text too short (${rawText.length} chars), likely blocked`, fetchDurationMs: Date.now() - t0 };
      }

      return {
        fetched: true,
        rawHtml: textElement.html() || "",
        rawText,
        fetchDurationMs: Date.now() - t0,
        httpStatus: statusCode
      };
    } catch (err: any) {
      if (attempts < 3 && err.code && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        await new Promise((r) => setTimeout(r, (attempts * 1000) + Math.random() * 500));
        continue;
      }
      return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
    }
  }
  return { fetched: false, fetchError: "Max retries exceeded", fetchDurationMs: Date.now() - t0 };
}
