import path from "path";
import fs from "fs";
import type { PortalName } from "./types";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "src", "data");
export const ARTIFACTS_DIR = process.env.SCRAPER_ARTIFACTS_DIR || path.join(ROOT, ".scraper-artifacts");
export const RUNS_DIR = path.join(ARTIFACTS_DIR, "runs");
export const PROFILES_DIR = path.join(ARTIFACTS_DIR, "profiles");
export const LINKEDIN_PROFILE_DIR = path.join(PROFILES_DIR, "linkedin-primary");
export const SNAPSHOT_DIR = path.join(ARTIFACTS_DIR, "snapshots");
export const EXTRACTION_DIR = path.join(ARTIFACTS_DIR, "extractions");
export const ENRICHMENT_CACHE_DIR = path.join(ARTIFACTS_DIR, "enrichment-cache");
export const METRICS_DIR = path.join(ARTIFACTS_DIR, "metrics");

// Ensure structure exists
for (const dir of [ARTIFACTS_DIR, RUNS_DIR, PROFILES_DIR, SNAPSHOT_DIR, EXTRACTION_DIR, ENRICHMENT_CACHE_DIR, METRICS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export const SEARCH_METRICS_NDJSON = path.join(METRICS_DIR, "search-metrics.ndjson");

export const LIVE_SCRAPED_JSON = path.join(DATA_DIR, "live-scraped.json");
export const CANDIDATE_PROFILE_JSON = path.join(DATA_DIR, "candidate-profile.json");

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
  portalConcurrency: Number(process.env.PORTAL_CONCURRENCY || 3),
  detailConcurrency: Number(process.env.DETAIL_CONCURRENCY || 8),
  llmConcurrency: Number(process.env.LLM_CONCURRENCY || 2),
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
  
  autoConfirm: process.env.AUTO_CONFIRM === "true",
};

export const DEFAULT_PORTALS: PortalName[] = ["LinkedIn", "Indeed", "Naukri"];
export const DEFAULT_KEYWORDS = [
  "Chief Marketing Officer",
  "Chief Growth Officer",
  "VP Marketing",
];
