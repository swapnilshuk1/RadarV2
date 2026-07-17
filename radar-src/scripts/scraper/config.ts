import path from "path";
import fs from "fs";
import type { PortalName } from "./types";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "src", "data");
export const RUNS_DIR = path.join(ROOT, ".scraper-cache", "runs");
export const SNAPSHOT_DIR = path.join(ROOT, ".scraper-cache", "snapshots");
export const EXTRACTION_DIR = path.join(ROOT, ".scraper-cache", "extractions");
export const PROFILES_DIR = path.join(ROOT, ".scraper-cache", "profiles");
export const LIVE_SCRAPED_JSON = path.join(DATA_DIR, "live-scraped.json");
export const CANDIDATE_PROFILE_JSON = path.join(DATA_DIR, "candidate-profile.json");

for (const d of [RUNS_DIR, SNAPSHOT_DIR, EXTRACTION_DIR, PROFILES_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

export const CONFIG = {
  maxPages: 2,
  maxCardsPerPage: 10,
  portalConcurrency: 3,          // portals in parallel
  cardConcurrency: 4,            // cards per portal in parallel
  navTimeoutMs: 35_000,
  detailTimeoutMs: 25_000,
  captchaGateWaitMs: 120_000,    // 2 min manual solve budget
  captchaPollMs: 3_000,
  minJitterMs: 900,
  maxJitterMs: 2600,
  snapshotFreshHours: 12,        // reuse snapshot if newer than this
  extractionFreshHours: 24,      // reuse extraction if newer than this
  retryPerUnit: 2,
};

export const DEFAULT_PORTALS: PortalName[] = ["LinkedIn", "Indeed", "Naukri"];
export const DEFAULT_KEYWORDS = [
  "Chief Marketing Officer",
  "Chief Growth Officer",
  "VP Marketing",
];
