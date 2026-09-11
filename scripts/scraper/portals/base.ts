import path from "path";
import fs from "fs";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import type { PortalName } from "../types";
import { PROFILES_DIR, RUNS_DIR, GLOBAL_MARKET_LOCK_PATH } from "../config";
import {
  acquireExclusiveLock,
  releaseExclusiveLock,
  type ExclusiveLockToken,
  type LockDeps,
} from "../run/exclusive-lock";
import { writeJsonAtomic } from "../utils/fs-atomic";

let stealthConfigured = false;
const chromiumExtra = chromium;

export function ensureStealth(): void {
  if (stealthConfigured) return;
  chromiumExtra.use(stealth());
  stealthConfigured = true;
}

export interface PortalRuntimeScope {
  mode: "GLOBAL_MARKET" | "SCOPED";
  tenantId?: string;
  personId?: string;
  runId: string;
}

export interface ProfileMetadata {
  mode: "SCOPED" | "GLOBAL_MARKET";
  tenantId?: string;
  personId?: string;
  lastUsedAt: string;
}

export interface PortalContextOptions {
  headless?: boolean;
}

interface CachedPortalContext {
  context: any;
  profileLock: ExclusiveLockToken;
}

const contextCache = new Map<string, CachedPortalContext>();

function contextKey(runId: string, portal: PortalName): string {
  return `${runId}:${portal}`;
}

/**
 * Returns the machine-level profile directory for a given portal.
 * RADAR normally has one scraper process on one machine/worker.
 */
export function profileDirFor(
  portal: PortalName,
  _scope?: PortalRuntimeScope,
  baseDir?: string,
): string {
  const portalLower = portal.toLowerCase();
  return path.join(
    baseDir || PROFILES_DIR,
    portalLower === "linkedin" ? "linkedin-primary" : portalLower
  );
}

/**
 * Returns the machine-level profile lock path for a given portal.
 */
export function profileLockPath(
  portal: PortalName,
  _scope?: PortalRuntimeScope,
  baseDir?: string,
): string {
  const lockRoot = path.join(baseDir || PROFILES_DIR, ".locks");
  return path.join(lockRoot, `${portal.toLowerCase()}.lock`);
}

export type ProfileMetadataInspection =
  | { status: "missing" }
  | { status: "valid"; metadata: ProfileMetadata }
  | { status: "invalid"; error: string };

/**
 * Inspects existing profile metadata distinguishing missing from corrupt/invalid.
 */
export function inspectProfileMetadata(targetDir: string): ProfileMetadataInspection {
  const metaPath = path.join(targetDir, "profile-metadata.json");
  if (!fs.existsSync(metaPath)) {
    return { status: "missing" };
  }
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.mode === "SCOPED" || parsed.mode === "GLOBAL_MARKET")) {
      return { status: "valid", metadata: parsed as ProfileMetadata };
    }
    return {
      status: "invalid",
      error: `Invalid profile-metadata schema: missing or unrecognized mode '${parsed?.mode}'`,
    };
  } catch (err: any) {
    return {
      status: "invalid",
      error: `Malformed profile-metadata JSON: ${err.message}`,
    };
  }
}

/**
 * Reads existing profile metadata if present and valid.
 */
export function readProfileMetadata(targetDir: string): ProfileMetadata | null {
  const res = inspectProfileMetadata(targetDir);
  return res.status === "valid" ? res.metadata : null;
}

/**
 * Writes profile metadata atomically to indicate mode, ownership, and last-used timestamp.
 */
export function writeProfileMetadata(
  targetDir: string,
  scope: PortalRuntimeScope
): void {
  fs.mkdirSync(targetDir, { recursive: true });
  const metadata: ProfileMetadata = {
    mode: scope.mode,
    tenantId: scope.tenantId,
    personId: scope.personId,
    lastUsedAt: new Date().toISOString(),
  };
  const finalPath = path.join(targetDir, "profile-metadata.json");
  try {
    writeJsonAtomic(finalPath, metadata);
  } catch (err: any) {
    throw new Error(
      `ATOMIC_METADATA_WRITE_FAILED: Failed to write profile metadata atomically in ${targetDir}: ${err.message}`
    );
  }
}

/**
 * Deterministic legacy profile migration with strict candidate precedence.
 */
export function maybeMigrateLegacyProfile(portal: PortalName, destination: string): boolean {
  const portalLower = portal.toLowerCase();

  // 1. Destination check: if it already exists and has actual profile files, do nothing
  if (fs.existsSync(destination)) {
    try {
      const files = fs.readdirSync(destination).filter((f) => f !== "profile-metadata.json");
      if (files.length > 0) return false;
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
    candidateLegacyDirs.push(path.join(PROFILES_DIR, "global", "linkedin"));
  } else {
    candidateLegacyDirs.push(path.join(scraperCacheDir, portalLower));
    candidateLegacyDirs.push(path.join(PROFILES_DIR, portalLower));
    candidateLegacyDirs.push(path.join(PROFILES_DIR, "global", portalLower));
  }

  const legacySource = candidateLegacyDirs.find((dir) => {
    try {
      if (!fs.existsSync(dir)) return false;
      if (path.resolve(dir) === path.resolve(destination)) return false;
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) return false;
      const files = fs.readdirSync(dir).filter((f) => f !== "profile-metadata.json");
      return files.length > 0;
    } catch {
      return false;
    }
  });

  if (!legacySource) return false;

  // 3. Stage copy in a temporary sibling directory and atomically rename upon success
  const parentDir = path.dirname(destination);
  const tempDir = path.join(
    parentDir,
    `.tmp_migration_${portalLower}_${Date.now()}_${process.pid}`
  );

  try {
    fs.mkdirSync(parentDir, { recursive: true });

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    fs.mkdirSync(tempDir, { recursive: true });
    fs.cpSync(legacySource, tempDir, { recursive: true, errorOnExist: false });

    // Verify tempDir has copied files
    const copiedFiles = fs.readdirSync(tempDir).filter((f) => f !== "profile-metadata.json");
    if (copiedFiles.length === 0) {
      throw new Error(`Migration copy from ${legacySource} resulted in empty directory`);
    }

    // If destination exists but was empty, remove it before rename (Windows compatibility)
    if (fs.existsSync(destination)) {
      const existingFiles = fs.readdirSync(destination).filter((f) => f !== "profile-metadata.json");
      if (existingFiles.length === 0) {
        fs.rmSync(destination, { recursive: true, force: true });
      } else {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return false;
      }
    }

    fs.renameSync(tempDir, destination);
    console.log(
      `[ProfileMigration] Successfully migrated legacy profile from ${legacySource} to ${destination}`
    );
    return true;
  } catch (err: any) {
    console.warn(
      `[ProfileMigration] Could not migrate legacy profile from ${legacySource} to ${destination}: ${err.message}`
    );
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
    return false;
  }
}

/**
 * Backwards compatibility helper for legacy migration tests and calls.
 */
export function maybeMigrateLegacyGlobalProfile(portal: PortalName): void {
  maybeMigrateLegacyProfile(portal, profileDirFor(portal));
}

/**
 * Prepares the profile directory for the authorized scope according to ownership rules.
 * MUST be executed while holding the exclusive portal lock.
 */
export function prepareProfileForScope(
  portal: PortalName,
  scope: PortalRuntimeScope,
  baseDir?: string
): string {
  const targetDir = profileDirFor(portal, scope, baseDir);
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  let hasProfileFiles = false;
  try {
    if (fs.existsSync(targetDir)) {
      const files = fs.readdirSync(targetDir).filter((f) => f !== "profile-metadata.json");
      hasProfileFiles = files.length > 0;
    }
  } catch {}

  if (!hasProfileFiles) {
    maybeMigrateLegacyProfile(portal, targetDir);
    writeProfileMetadata(targetDir, scope);
    return targetDir;
  }

  // Profile exists: inspect metadata to decide reuse vs retirement
  const metaInspection = inspectProfileMetadata(targetDir);

  if (metaInspection.status === "invalid") {
    throw new Error(
      `CORRUPT_PROFILE_METADATA: Profile at ${targetDir} contains malformed or unreadable metadata: ${metaInspection.error}. Failing closed to prevent unsafe cross-scope adoption.`
    );
  }

  let shouldRetire = false;

  if (metaInspection.status === "valid") {
    const metadata = metaInspection.metadata;
    if (scope.mode === "SCOPED") {
      if (
        metadata.mode !== "SCOPED" ||
        metadata.tenantId !== scope.tenantId ||
        metadata.personId !== scope.personId
      ) {
        shouldRetire = true;
      }
    } else {
      // scope.mode === "GLOBAL_MARKET"
      if (metadata.mode !== "GLOBAL_MARKET") {
        shouldRetire = true;
      }
    }
  } else {
    // metaInspection.status === "missing":
    // Populated profile with missing metadata is a legacy pre-metadata profile.
    // Adopt once as legacy for current scope by stamping metadata.
  }

  if (shouldRetire) {
    const retiredDir = `${targetDir}.retired.${Date.now()}`;
    console.log(
      `[Profile] Retiring mismatched profile from ${targetDir} to ${retiredDir} (previous: ${JSON.stringify(metaInspection.status === "valid" ? metaInspection.metadata : null)}, current: ${JSON.stringify(scope)})`
    );
    try {
      fs.renameSync(targetDir, retiredDir);
    } catch (err: any) {
      throw new Error(
        `PROFILE_RETIREMENT_FAILED: Failed to retire mismatched profile from ${targetDir} to ${retiredDir}: ${err.message}`
      );
    }
    fs.mkdirSync(targetDir, { recursive: true });
    writeProfileMetadata(targetDir, scope);
    return targetDir;
  }

  // Valid reuse (or legacy adoption): update last-used timestamp
  writeProfileMetadata(targetDir, scope);
  return targetDir;
}

/**
 * Bounded async sleep helper for lock contention retries.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getPortalContext(
  portal: PortalName,
  scope: PortalRuntimeScope = { mode: "GLOBAL_MARKET", runId: `adhoc-${Date.now()}` },
  deps: LockDeps = {},
  options?: PortalContextOptions
): Promise<any> {
  ensureStealth();

  const key = contextKey(scope.runId, portal);
  const cached = contextCache.get(key);
  if (cached) return cached.context;

  const lockPath = profileLockPath(portal, scope);

  // 1. Acquire portal exclusive lock with bounded asynchronous retry
  let profileLock: ExclusiveLockToken | null = null;
  const maxAttempts = 3;
  let lastLockError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      profileLock = acquireExclusiveLock(
        lockPath,
        `profile:${scope.runId}:${portal}`,
        deps
      );
      break;
    } catch (err: any) {
      lastLockError = err;
      if (attempt < maxAttempts) {
        await sleep(500);
      }
    }
  }

  if (!profileLock) {
    const err = new Error(
      `PORTAL_PROFILE_LOCKED: ${portal} profile is already owned. ${lastLockError?.message}`
    );
    (err as any).code = "PORTAL_PROFILE_LOCKED";
    throw err;
  }

  // 2. Prepare profile under the held lock
  let userDataDir: string;
  try {
    userDataDir = prepareProfileForScope(portal, scope);
  } catch (err: any) {
    releaseExclusiveLock(profileLock);
    const initErr = new Error(
      `PORTAL_INITIALIZATION_FAILED: Could not prepare profile for ${portal}: ${err.message}`
    );
    (initErr as any).code = "PORTAL_INITIALIZATION_FAILED";
    throw initErr;
  }

  const isCloudEnv = !!(
    process.env.RENDER ||
    process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.CI
  );

  const isHeadless =
    options?.headless !== undefined
      ? options.headless
      : process.env.HEADLESS !== undefined
      ? process.env.HEADLESS === "true" || process.env.HEADLESS === "1"
      : isCloudEnv;

  try {
    const context = await chromiumExtra.launchPersistentContext(
      userDataDir,
      {
        headless: isHeadless,
        viewport: { width: 1280, height: 800 },
        // Native userAgent: do not set hardcoded userAgent string
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
      }
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
  } catch (err: any) {
    releaseExclusiveLock(profileLock);
    const launchErr = new Error(
      `PORTAL_BROWSER_LAUNCH_FAILED: Failed to launch browser context for ${portal}: ${err.message}`
    );
    (launchErr as any).code = "PORTAL_BROWSER_LAUNCH_FAILED";
    throw launchErr;
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
  const lockPath = GLOBAL_MARKET_LOCK_PATH || path.join(RUNS_DIR, ".global_market.lock");
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
