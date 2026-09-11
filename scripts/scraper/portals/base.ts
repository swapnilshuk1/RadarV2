import path from "path";
import fs from "fs";
import crypto from "crypto";
import { chromium as chromiumExtra } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

import { PROFILES_DIR } from "../config";
import type { PortalName } from "../types";
import {
  acquireExclusiveLock,
  releaseExclusiveLock,
  type ExclusiveLockToken,
  type LockDeps,
} from "../run/exclusive-lock";

export interface PortalRuntimeScope {
  runId: string;
  mode: "SCOPED" | "GLOBAL_MARKET";
  tenantId?: string;
  personId?: string;
}

interface CachedPortalContext {
  context: any;
  profileLock: ExclusiveLockToken;
}

const contextCache = new Map<string, CachedPortalContext>();

let stealthApplied = false;

function ensureStealth(): void {
  if (stealthApplied) return;
  chromiumExtra.use(stealthPlugin());
  stealthApplied = true;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function contextKey(runId: string, portal: PortalName): string {
  return `${runId}:${portal}`;
}

export function profileDirFor(
  portal: PortalName,
  scope: PortalRuntimeScope,
): string {
  if (scope.mode === "SCOPED") {
    if (!scope.tenantId || !scope.personId) {
      throw new Error(
        "PROFILE_SCOPE_INVALID: SCOPED browser profile requires tenantId and personId.",
      );
    }

    return path.join(
      PROFILES_DIR,
      "tenants",
      sha256(scope.tenantId),
      sha256(scope.personId),
      portal.toLowerCase(),
    );
  }

  return path.join(
    PROFILES_DIR,
    "global",
    portal.toLowerCase(),
  );
}

export function profileLockPath(
  portal: PortalName,
  scope: PortalRuntimeScope,
): string {
  const lockRoot = path.join(PROFILES_DIR, ".locks");

  if (scope.mode === "SCOPED") {
    if (!scope.tenantId || !scope.personId) {
      throw new Error("PROFILE_SCOPE_INVALID");
    }

    return path.join(
      lockRoot,
      `tenant_${sha256(scope.tenantId)}_person_${sha256(scope.personId)}_portal_${portal.toLowerCase()}.lock`,
    );
  }

  return path.join(
    lockRoot,
    `global_portal_${portal.toLowerCase()}.lock`,
  );
}

export function maybeMigrateLegacyGlobalProfile(portal: PortalName): void {
  const portalLower = portal.toLowerCase();
  const globalDir = path.join(PROFILES_DIR, "global");
  const destination = path.join(globalDir, portalLower);

  // 1. Destination check: if it already exists and has files, an established profile exists -> do nothing
  if (fs.existsSync(destination)) {
    try {
      const files = fs.readdirSync(destination);
      if (files.length > 0) return;
    } catch {}
  }

  // 2. Identify candidate legacy profile sources by historical precedence
  const candidateLegacyDirs: string[] = [];
  const scraperCacheDir = path.join(process.cwd(), ".scraper-cache", "profiles");

  if (portalLower === "linkedin") {
    if (process.env.LINKEDIN_PROFILE_DIR && process.env.LINKEDIN_PROFILE_DIR.trim().length > 0) {
      candidateLegacyDirs.push(path.resolve(process.env.LINKEDIN_PROFILE_DIR.trim()));
    }
    candidateLegacyDirs.push(path.join(scraperCacheDir, "linkedin"));
    candidateLegacyDirs.push(path.join(scraperCacheDir, "linkedin-primary"));
    candidateLegacyDirs.push(path.join(PROFILES_DIR, "linkedin-primary"));
    candidateLegacyDirs.push(path.join(PROFILES_DIR, "linkedin"));
  } else {
    candidateLegacyDirs.push(path.join(scraperCacheDir, portalLower));
    candidateLegacyDirs.push(path.join(PROFILES_DIR, portalLower));
  }

  const legacySource = candidateLegacyDirs.find((dir) => {
    try {
      if (!fs.existsSync(dir)) return false;
      if (path.resolve(dir) === path.resolve(destination)) return false;
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) return false;
      const files = fs.readdirSync(dir);
      return files.length > 0;
    } catch {
      return false;
    }
  });

  if (!legacySource) return;

  // 3. Stage copy in a temporary sibling directory and atomically rename upon success
  const tempDir = path.join(
    globalDir,
    `.tmp_migration_${portalLower}_${Date.now()}_${process.pid}`
  );

  try {
    fs.mkdirSync(globalDir, { recursive: true });

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    fs.mkdirSync(tempDir, { recursive: true });
    fs.cpSync(legacySource, tempDir, { recursive: true, errorOnExist: false });

    // Verify tempDir has copied files
    const copiedFiles = fs.readdirSync(tempDir);
    if (copiedFiles.length === 0) {
      throw new Error(`Migration copy from ${legacySource} resulted in empty directory`);
    }

    // If destination exists but was empty, remove it before rename so rename succeeds on Windows
    if (fs.existsSync(destination)) {
      const existingFiles = fs.readdirSync(destination);
      if (existingFiles.length === 0) {
        fs.rmdirSync(destination);
      } else {
        // Destination became populated concurrently; discard temp and return
        fs.rmSync(tempDir, { recursive: true, force: true });
        return;
      }
    }

    fs.renameSync(tempDir, destination);
    console.log(
      `[ProfileMigration] Successfully migrated legacy global profile from ${legacySource} to ${destination}`
    );
  } catch (err: any) {
    console.warn(
      `[ProfileMigration] Could not migrate legacy global profile from ${legacySource} to ${destination}: ${err.message}`
    );
    // Cleanup temporary directory on failure so retry remains possible
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
    // Ensure final destination remains absent if failed or left empty
    try {
      if (fs.existsSync(destination)) {
        const destFiles = fs.readdirSync(destination);
        if (destFiles.length === 0) {
          fs.rmdirSync(destination);
        }
      }
    } catch {}
  }
}

export async function getPortalContext(
  portal: PortalName,
  scope: PortalRuntimeScope,
  deps: LockDeps = {},
): Promise<any> {
  ensureStealth();

  if (scope.mode === "GLOBAL_MARKET") {
    maybeMigrateLegacyGlobalProfile(portal);
  }

  const key = contextKey(scope.runId, portal);
  const cached = contextCache.get(key);
  if (cached) return cached.context;

  const userDataDir = profileDirFor(portal, scope);
  const lockPath = profileLockPath(portal, scope);

  let profileLock: ExclusiveLockToken;

  try {
    profileLock = acquireExclusiveLock(
      lockPath,
      `profile:${scope.runId}:${portal}`,
      deps,
    );
  } catch (err: any) {
    throw new Error(
      `PROFILE_IN_USE_CONFLICT: ${portal} profile is already owned. ${err.message}`,
    );
  }

  fs.mkdirSync(userDataDir, { recursive: true });

  const isCloudEnv = !!(
    process.env.RENDER ||
    process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.CI ||
    process.env.NODE_ENV === "production"
  );

  const isHeadless = process.env.HEADLESS
    ? process.env.HEADLESS === "true"
    : isCloudEnv;

  try {
    const context = await chromiumExtra.launchPersistentContext(
      userDataDir,
      {
        headless: isHeadless,
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/126.0.0.0 Safari/537.36",
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
      },
    );

    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
        Object.defineProperty(navigator, "languages", {
          get: () => ["en-US", "en"],
        });
      } catch {}
    });

    contextCache.set(key, {
      context,
      profileLock,
    });

    return context;
  } catch (err) {
    releaseExclusiveLock(profileLock);
    throw err;
  }
}

export async function closePortalContextsForRun(
  runId: string,
): Promise<void> {
  const prefix = `${runId}:`;

  for (const [key, entry] of [...contextCache.entries()]) {
    if (!key.startsWith(prefix)) continue;

    try {
      await entry.context.close();
    } catch {}

    releaseExclusiveLock(entry.profileLock);
    contextCache.delete(key);
  }
}

export async function closeAllPortalContexts(): Promise<void> {
  for (const [key, entry] of [...contextCache.entries()]) {
    try {
      await entry.context.close();
    } catch {}

    releaseExclusiveLock(entry.profileLock);
    contextCache.delete(key);
  }
}

export function acquireGlobalMarketLock(runId: string, deps: LockDeps = {}): ExclusiveLockToken {
  const lockPath = path.join(process.cwd(), ".radar", "runs", ".global_market.lock");
  try {
    return acquireExclusiveLock(lockPath, `global-market:${runId}`, deps);
  } catch (err: any) {
    if (err?.message?.includes("LOCKED_BY_LIVE_PROCESS") || err?.code === "LOCKED_BY_LIVE_PROCESS") {
      throw new Error(`GLOBAL_MARKET_RUN_LOCKED: another global market run is already executing (${err.message})`);
    }
    throw err;
  }
}

export function releaseGlobalMarketLock(token: ExclusiveLockToken | null | undefined): void {
  releaseExclusiveLock(token);
}
