import path from "path";
import fs from "fs";
import type { PortalName } from "./types";

const isBrowser = typeof window !== "undefined" || typeof process === "undefined" || !process.cwd;

export const ROOT = !isBrowser && typeof process !== "undefined" && process.cwd ? process.cwd() : "";

// Helper to load .env files
function loadEnvFile(filename: string) {
  if (isBrowser) return;
  try {
    const filePath = path.join(ROOT, filename);
    if (fs.existsSync && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index !== -1) {
          const key = trimmed.slice(0, index).trim();
          let value = trimmed.slice(index + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (process.env && !process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch {}
}

// Load configurations
loadEnvFile(".env");
loadEnvFile("gemini.env");
loadEnvFile("groq.env");

export const DATA_DIR = !isBrowser ? path.join(ROOT, "src", "data") : "";

const isServerless = !isBrowser && !!(process.env?.VERCEL || process.env?.AWS_LAMBDA_FUNCTION_NAME || process.env?.NETLIFY);
const defaultArtifactsDir = !isBrowser
  ? (isServerless ? path.join("/tmp", ".scraper-artifacts") : path.join(ROOT, ".scraper-artifacts"))
  : "";

export const ARTIFACTS_DIR = (!isBrowser && process.env?.SCRAPER_ARTIFACTS_DIR) || defaultArtifactsDir;
export const RUNS_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "runs") : "";
export const PROFILES_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "profiles") : "";
export const LINKEDIN_PROFILE_DIR = !isBrowser ? path.join(PROFILES_DIR, "linkedin-primary") : "";
export const SNAPSHOT_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "snapshots") : "";
export const EXTRACTION_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "extractions") : "";
export const ENRICHMENT_CACHE_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "enrichment-cache") : "";
export const METRICS_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "metrics") : "";

// Ensure structure exists safely (using /tmp on serverless or catch EROFS errors)
if (!isBrowser) {
  for (const dir of [ARTIFACTS_DIR, RUNS_DIR, PROFILES_DIR, SNAPSHOT_DIR, EXTRACTION_DIR, ENRICHMENT_CACHE_DIR, METRICS_DIR]) {
    try {
      if (fs.existsSync && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err: any) {
      console.warn(`[Config] Failed to ensure directory exists: ${dir}. Error: ${err.message}`);
    }
  }
}

export const SEARCH_METRICS_NDJSON = !isBrowser ? path.join(METRICS_DIR, "search-metrics.ndjson") : "";

export const LIVE_SCRAPED_JSON = !isBrowser ? path.join(DATA_DIR, "live-scraped.json") : "";
export const CANDIDATE_PROFILE_JSON = !isBrowser ? path.join(DATA_DIR, "candidate-profile.json") : "";

// ── LLM / Enrichment provider configuration ─────────────────────────────────
// LLM_PROVIDER: "groq" | "gemini" | "none"  (default: auto-detect from keys)
// GROQ_API_KEY: Groq API key
// GROQ_MODEL:   Groq model ID (default: llama-3.3-70b-versatile)
// GEMINI_API_KEY: Google Gemini API key
// ENRICHMENT_MODE: "deterministic" | "smart" | "maximum" (default: smart)
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  maxPages: 2,
  maxCardsPerPage: 10,
  portalMaxCardsPerPage: {
    LinkedIn: 25,
    Naukri: 20,
    Indeed: 15,
  } as Record<string, number>,
  getMaxCardsPerPage(portalName?: string): number {
    if (portalName && this.portalMaxCardsPerPage[portalName]) {
      return this.portalMaxCardsPerPage[portalName];
    }
    return this.maxCardsPerPage;
  },
  portalConcurrency: Number((!isBrowser && process.env?.PORTAL_CONCURRENCY) || 3),
  detailConcurrency: Number((!isBrowser && process.env?.DETAIL_CONCURRENCY) || 8),
  llmConcurrency: Number((!isBrowser && process.env?.LLM_CONCURRENCY) || 2),
  navTimeoutMs: 30_000,
  detailTimeoutMs: 15_000,
  captchaGateWaitMs: 120_000,    // 2 min manual solve budget
  captchaPollMs: 5_000,          // check interval
  
  // Network Interception for Playwright browsers
  networkInterception: {
    blockedResourceTypes: ["image", "media", "font", "ping", "manifest", "other"],
    allowedResourceTypes: ["document", "script", "xhr", "fetch", "stylesheet"],
    blockedDomains: [
      "google-analytics.com",
      "doubleclick.net",
      "googletagmanager.com",
      "facebook.net",
      "clarity.ms",
      "hotjar.com",
    ]
  },
  minJitterMs: 900,
  maxJitterMs: 2600,
  snapshotFreshHours: 12,        // reuse snapshot if newer than this
  extractionFreshHours: 24,      // reuse extraction if newer than this
  retryPerUnit: 2,
  // Card-wait timeouts (ms) — how long to wait for JS-rendered cards to appear
  cardWaitTimeoutMs: 10_000,
  
  autoConfirm: !isBrowser && process.env?.AUTO_CONFIRM === "true",
};

export const DEFAULT_PORTALS: PortalName[] = ["LinkedIn", "Indeed", "Naukri"];
export const DEFAULT_KEYWORDS = [
  "Chief Marketing Officer",
  "Chief Growth Officer",
  "VP Marketing",
];
