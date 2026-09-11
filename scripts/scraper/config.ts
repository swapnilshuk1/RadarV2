import path from "path";
import fs from "fs";
import type { PortalName } from "./types";

import { loadUnifiedEnvironment } from "../../src/lib/env";

const isBrowser = typeof window !== "undefined" || typeof process === "undefined" || !process.cwd;

export const ROOT = !isBrowser && typeof process !== "undefined" && process.cwd ? process.cwd() : "";

// Load unified environment variables across all config files with shell precedence
if (!isBrowser) {
  loadUnifiedEnvironment({ rootDir: ROOT });
}

export const DATA_DIR = !isBrowser ? path.join(ROOT, "src", "data") : "";

export const isServerless = !isBrowser && !!(process.env?.VERCEL || process.env?.AWS_LAMBDA_FUNCTION_NAME || process.env?.NETLIFY);
const defaultArtifactsDir = !isBrowser
  ? (isServerless ? path.join("/tmp", ".scraper-artifacts") : path.join(ROOT, ".scraper-artifacts"))
  : "";

export const ARTIFACTS_DIR = (!isBrowser && process.env?.SCRAPER_ARTIFACTS_DIR) || defaultArtifactsDir;
export const RUNS_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "runs") : "";
export const GLOBAL_MARKET_LOCK_PATH = !isBrowser ? path.join(RUNS_DIR, ".global_market.lock") : "";
export const PROFILES_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "profiles") : "";
export const LINKEDIN_PROFILE_DIR = !isBrowser ? path.join(PROFILES_DIR, "linkedin-primary") : "";
export const SNAPSHOT_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "snapshots") : "";
export const EXTRACTION_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "extractions") : "";
export const ENRICHMENT_CACHE_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "enrichment-cache") : "";
export const METRICS_DIR = !isBrowser ? path.join(ARTIFACTS_DIR, "metrics") : "";

export interface StorageVerificationResult {
  ok: boolean;
  fatalError?: string;
  warnings: string[];
  cacheDegraded: boolean;
}

/**
 * Verifies writable status of all required artifact directories.
 * Essential directories (ARTIFACTS_DIR, RUNS_DIR, PROFILES_DIR) fail fast.
 * Nonessential cache directories degrade with a warning.
 */
export function verifyArtifactStorage(): StorageVerificationResult {
  const warnings: string[] = [];
  let cacheDegraded = false;

  if (isBrowser) {
    return { ok: true, warnings, cacheDegraded: false };
  }

  if (isServerless) {
    warnings.push(
      "[Config] Ephemeral runtime detected (serverless container). Browser profiles and snapshots are temporary."
    );
  }

  const testWritable = (dir: string): boolean => {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const testFile = path.join(dir, `.write-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      fs.writeFileSync(testFile, "test", "utf-8");
      fs.unlinkSync(testFile);
      return true;
    } catch {
      return false;
    }
  };

  // Essential directories
  const essential = [
    { name: "ARTIFACTS_DIR", path: ARTIFACTS_DIR },
    { name: "RUNS_DIR", path: RUNS_DIR },
    { name: "PROFILES_DIR", path: PROFILES_DIR },
  ];

  for (const item of essential) {
    if (!testWritable(item.path)) {
      return {
        ok: false,
        fatalError: `FATAL_STORAGE_UNWRITABLE: Essential scraper directory '${item.name}' at '${item.path}' is not writable.`,
        warnings,
        cacheDegraded,
      };
    }
  }

  // Nonessential cache directories
  const nonessential = [
    { name: "SNAPSHOT_DIR", path: SNAPSHOT_DIR },
    { name: "EXTRACTION_DIR", path: EXTRACTION_DIR },
    { name: "ENRICHMENT_CACHE_DIR", path: ENRICHMENT_CACHE_DIR },
    { name: "METRICS_DIR", path: METRICS_DIR },
  ];

  for (const item of nonessential) {
    if (!testWritable(item.path)) {
      warnings.push(
        `[Config] Cache directory '${item.name}' at '${item.path}' is not writable. Cache persistence degraded.`
      );
      cacheDegraded = true;
    }
  }

  return { ok: true, warnings, cacheDegraded };
}

// Ensure structure exists safely on startup
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
    Naukri: 60,
    Indeed: 25,
  } as Record<string, number>,
  getMaxCardsPerPage(portalName?: string): number {
    if (portalName && this.portalMaxCardsPerPage[portalName]) {
      return this.portalMaxCardsPerPage[portalName];
    }
    return this.maxCardsPerPage;
  },
  portalConcurrency: Number((!isBrowser && process.env?.PORTAL_CONCURRENCY) || 3),
  detailConcurrency: Number((!isBrowser && process.env?.DETAIL_CONCURRENCY) || 3),
  llmConcurrency: Number((!isBrowser && process.env?.LLM_CONCURRENCY) || 2),
  navTimeoutMs: 60_000,
  detailTimeoutMs: 15_000,
  captchaGateWaitMs: 120_000,    // 2 min manual solve budget
  captchaPollMs: 5_000,          // check interval
  
  // Network Interception for Playwright browsers
  networkInterception: {
    blockedResourceTypes: ["image", "media", "font"],
    allowedResourceTypes: ["document", "script", "xhr", "fetch", "stylesheet", "websocket"],
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
  
  autoConfirm: !isBrowser && process.env?.AUTO_CONFIRM !== "false",
};

export const DEFAULT_PORTALS: PortalName[] = ["LinkedIn", "Indeed", "Naukri"];
export const DEFAULT_KEYWORDS = [
  "Chief Marketing Officer",
  "Chief Growth Officer",
  "VP Marketing",
];
