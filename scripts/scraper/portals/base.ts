import path from "path";
import fs from "fs";
import { chromium as chromiumExtra } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { PROFILES_DIR, LINKEDIN_PROFILE_DIR, CONFIG } from "../config";
import type { PortalName } from "../types";
import crypto from "crypto";
import { acquireExclusiveLock, releaseExclusiveLock, type ExclusiveLockToken } from "../run/manager";

// Stealth plugin is essential — LinkedIn's automation detection blocks the
// search page outright without it (per docs/scraper-quick-wins §"What not").
let stealthApplied = false;
function ensureStealth() {
  if (stealthApplied) return;

  // Filter out non-fatal stealth shim warnings on closed pages
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const msg = args[0] ? String(args[0]) : "";
    if (msg.includes("stealth/evasions") || msg.includes("Target page, context or browser has been closed")) {
      return; // Suppress non-fatal stealth plugin closed-tab warnings
    }
    originalConsoleError.apply(console, args);
  };

  chromiumExtra.use(stealthPlugin());
  stealthApplied = true;
}

// Resolve the correct user-data directory per portal.
function profileDirFor(portal: PortalName): string {
  if (portal === "LinkedIn") {
    console.log("[scrape:LinkedIn] LinkedIn profile resolution:");
    
    const envDir = process.env.LINKEDIN_PROFILE_DIR;
    if (envDir && fs.existsSync(envDir)) {
      console.log(`✓ Found ENV profile: ${envDir}`);
      console.log(`Using profile: ${envDir}`);
      return envDir;
    }
    console.log("✓ LINKEDIN_PROFILE_DIR env var not set or invalid");

    for (const legacyName of ["linkedin", "linkedin-primary"]) {
      const legacyDir = path.join(process.cwd(), ".scraper-cache", "profiles", legacyName);
      if (fs.existsSync(legacyDir)) {
        console.log(`✓ Found legacy profile: ${legacyDir}`);
        console.log(`Using profile: ${legacyDir}`);
        return legacyDir;
      }
    }

    if (fs.existsSync(LINKEDIN_PROFILE_DIR)) {
      console.log(`✓ Found artifacts profile: ${LINKEDIN_PROFILE_DIR}`);
      console.log(`Using profile: ${LINKEDIN_PROFILE_DIR}`);
      return LINKEDIN_PROFILE_DIR;
    }

    console.log("No existing LinkedIn profile found.");
    console.log(`Creating new profile: ${LINKEDIN_PROFILE_DIR}`);
    return LINKEDIN_PROFILE_DIR;
  }
  /*
   * The finalized scraper stored non-LinkedIn portal sessions here.  Keep
   * that established location ahead of an empty artifacts directory so an
   * application restart does not discard a working login.
   */
  const legacyDir = path.join(
    process.cwd(),
    ".scraper-cache",
    "profiles",
    portal.toLowerCase(),
  );
  if (fs.existsSync(legacyDir)) {
    console.log(`[scrape:${portal}] Reusing legacy persistent profile: ${legacyDir}`);
    return legacyDir;
  }

  return path.join(PROFILES_DIR, portal.toLowerCase());
}

export function resolveProfileDir(portal: PortalName, tenantId?: string, personId?: string): string {
  if (tenantId && personId) {
    const tenantHash = crypto.createHash("sha256").update(tenantId).digest("hex");
    const personHash = crypto.createHash("sha256").update(personId).digest("hex");
    return path.join(PROFILES_DIR, "tenants", `tenant_${tenantHash}`, `person_${personHash}`, portal.toLowerCase());
  }
  return profileDirFor(portal);
}

export function resolveProfileKey(portal: PortalName, tenantId?: string, personId?: string): string {
  if (tenantId && personId) {
    const tenantHash = crypto.createHash("sha256").update(tenantId).digest("hex");
    const personHash = crypto.createHash("sha256").update(personId).digest("hex");
    return `tenant_${tenantHash}_person_${personHash}_portal_${portal.toLowerCase()}`;
  }
  return `global_portal_${portal.toLowerCase()}`;
}

const GLOBAL_MARKET_LOCK_PATH = path.join(process.cwd(), ".radar", "runs", ".global_market.lock");

export function acquireGlobalMarketLock(runId: string): ExclusiveLockToken {
  return acquireExclusiveLock(GLOBAL_MARKET_LOCK_PATH, { runId, lockType: "GLOBAL_MARKET" });
}

export function releaseGlobalMarketLock(token: ExclusiveLockToken): void {
  releaseExclusiveLock(token);
}

export interface PortalContextOptions {
  runId?: string;
  tenantId?: string;
  personId?: string;
}

// Map from `${runId}:${portal}` -> { ctx, token }
const contextCache = new Map<string, { ctx: any; token?: ExclusiveLockToken }>();

export async function getPortalContext(portal: PortalName, opts?: PortalContextOptions): Promise<any> {
  ensureStealth();
  const runKey = opts?.runId || "global";
  const cacheKey = `${runKey}:${portal}`;

  if (contextCache.has(cacheKey)) {
    return contextCache.get(cacheKey)!.ctx;
  }

  const userDataDir = resolveProfileDir(portal, opts?.tenantId, opts?.personId);
  fs.mkdirSync(userDataDir, { recursive: true });

  const profileKey = resolveProfileKey(portal, opts?.tenantId, opts?.personId);
  const lockToken = acquireExclusiveLock(
    path.join(userDataDir, ".profile.lock"),
    { runId: runKey, profileKey }
  );

  const isCloudEnv = !!(
    process.env.RENDER ||
    process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.CI ||
    process.env.NODE_ENV === "production"
  );
  const isHeadless = process.env.HEADLESS ? process.env.HEADLESS === "true" : isCloudEnv;

  let ctx;
  try {
    ctx = await chromiumExtra.launchPersistentContext(userDataDir, {
      headless: isHeadless,
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  } catch (err: any) {
    releaseExclusiveLock(lockToken);
    const msg = err?.message ?? "";
    console.error(`[BrowserLaunchError] userDataDir: ${userDataDir} msg: ${msg}`);
    if (
      msg.includes("existing browser session") ||
      msg.includes("already in use") ||
      msg.includes("ProcessSingleton")
    ) {
      throw new Error(`Browser profile is already in use by another scraper. Please wait for it to finish or close the conflicting process. (${userDataDir})`);
    } else {
      throw err;
    }
  }

  // Phase 4: Centralized Network Interception & Native Stealth Injection
  try {
    await ctx.addInitScript(() => {
      try {
        // Override navigator.webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // Override window.chrome
        (window as any).chrome = (window as any).chrome || {
          app: { isInstalled: false },
          runtime: {},
          csi: () => {},
          loadTimes: () => {}
        };
        // Override navigator.languages
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      } catch {}
    });
  } catch {}

  contextCache.set(cacheKey, { ctx, token: lockToken });
  return ctx;
}

export async function closePortalContextsForRun(runId: string): Promise<void> {
  const prefix = `${runId}:`;
  for (const [key, entry] of Array.from(contextCache.entries())) {
    if (key.startsWith(prefix)) {
      try { await entry.ctx.close(); } catch { /* already closed */ }
      if (entry.token) {
        releaseExclusiveLock(entry.token);
      }
      contextCache.delete(key);
    }
  }
}

export async function closeAllPortalContexts(): Promise<void> {
  for (const entry of contextCache.values()) {
    try { await entry.ctx.close(); } catch { /* already closed */ }
    if (entry.token) {
      releaseExclusiveLock(entry.token);
    }
  }
  contextCache.clear();
}
