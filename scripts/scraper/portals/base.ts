import path from "path";
import fs from "fs";
import { chromium as chromiumExtra } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { PROFILES_DIR, LINKEDIN_PROFILE_DIR, CONFIG } from "../config";
import type { PortalName } from "../types";

// Stealth plugin is essential — LinkedIn's automation detection blocks the
// search page outright without it (per docs/scraper-quick-wins §"What not").
let stealthApplied = false;
function ensureStealth() {
  if (stealthApplied) return;
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

    if (fs.existsSync(LINKEDIN_PROFILE_DIR)) {
      console.log(`✓ Found artifacts profile: ${LINKEDIN_PROFILE_DIR}`);
      console.log(`Using profile: ${LINKEDIN_PROFILE_DIR}`);
      return LINKEDIN_PROFILE_DIR;
    }

    const legacyDir = path.join(process.cwd(), ".scraper-cache", "profiles", "linkedin-primary");
    if (fs.existsSync(legacyDir)) {
      console.log(`✓ Found legacy profile: ${legacyDir}`);
      console.log(`Using profile: ${legacyDir}`);
      return legacyDir;
    }

    console.log("No existing LinkedIn profile found.");
    console.log(`Creating new profile: ${LINKEDIN_PROFILE_DIR}`);
    return LINKEDIN_PROFILE_DIR;
  }
  return path.join(PROFILES_DIR, portal.toLowerCase());
}

// One persistent context per portal so cookies/logins survive between runs.
// Sharing a single context across portals bleeds cookies; separate profiles
// keep LinkedIn's automation-detection cookies away from Naukri.
const contextCache = new Map<PortalName, any>();

export async function getPortalContext(portal: PortalName): Promise<any> {
  ensureStealth();
  if (contextCache.has(portal)) return contextCache.get(portal);
  const userDataDir = profileDirFor(portal);
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
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  } catch (err: any) {
    const msg = err?.message ?? "";
    if (
      msg.includes("existing browser session") ||
      msg.includes("already in use") ||
      msg.includes("lock")
    ) {
      throw new Error(`Browser profile is already in use by another scraper. Please wait for it to finish or close the conflicting process. (${userDataDir})`);
    } else {
      throw err;
    }
  }

  // Phase 4: Centralized Network Interception

  contextCache.set(portal, ctx);
  return ctx;
}

export async function closeAllPortalContexts(): Promise<void> {
  for (const ctx of contextCache.values()) {
    try { await ctx.close(); } catch { /* already closed */ }
  }
  contextCache.clear();
}
