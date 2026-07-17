import path from "path";
import { chromium as chromiumExtra } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { PROFILES_DIR } from "../config";
import type { PortalName } from "../types";

// Stealth plugin is essential — LinkedIn's automation detection blocks the
// search page outright without it (per docs/scraper-quick-wins §"What not").
let stealthApplied = false;
function ensureStealth() {
  if (stealthApplied) return;
  chromiumExtra.use(stealthPlugin());
  stealthApplied = true;
}

// One persistent context per portal so cookies/logins survive between runs.
// Sharing a single context across portals bleeds cookies; separate profiles
// keep LinkedIn's automation-detection cookies away from Naukri.
const contextCache = new Map<PortalName, any>();

export async function getPortalContext(portal: PortalName): Promise<any> {
  ensureStealth();
  if (contextCache.has(portal)) return contextCache.get(portal);
  const userDataDir = path.join(PROFILES_DIR, portal.toLowerCase());
  const ctx = await chromiumExtra.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  contextCache.set(portal, ctx);
  return ctx;
}

export async function closeAllPortalContexts(): Promise<void> {
  for (const ctx of contextCache.values()) {
    try { await ctx.close(); } catch { /* already closed */ }
  }
  contextCache.clear();
}
