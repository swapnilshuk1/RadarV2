import fs from "fs";
import path from "path";
import os from "os";
import { chromium } from "playwright-extra";
import { loadUnifiedEnvironment } from "../../src/lib/env";
import {
  ARTIFACTS_DIR,
  PROFILES_DIR,
  RUNS_DIR,
  GLOBAL_MARKET_LOCK_PATH,
  verifyArtifactStorage,
  DEFAULT_PORTALS,
} from "./config";
import { getDatabaseAdapter } from "../../src/data/database";
import { profileLockPath, readProfileMetadata, profileDirFor } from "./portals/base";
import { readExclusiveLock, defaultIsProcessAlive } from "./run/exclusive-lock";
import { resolveScraperRuntimeOptions } from "./options";

export interface PreflightDiagnosticReport {
  overallStatus: "OK" | "DEGRADED" | "FATAL";
  checks: {
    environment: { status: "OK" | "WARN"; details: string };
    storage: { status: "OK" | "WARN" | "FATAL"; details: string };
    database: { status: "OK" | "DEGRADED" | "FATAL"; details: string };
    browser: { status: "OK" | "FATAL"; details: string };
    portalLocks: Record<string, { status: "OK" | "DEGRADED"; details: string }>;
  };
}

/**
 * Runs a deterministic, self-contained preflight check before scraping.
 * Does not make external network requests.
 */
export async function runScraperPreflight(
  cliArgs: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<PreflightDiagnosticReport> {
  loadUnifiedEnvironment();
  const options = resolveScraperRuntimeOptions(cliArgs, env);

  const report: PreflightDiagnosticReport = {
    overallStatus: "OK",
    checks: {
      environment: { status: "OK", details: "" },
      storage: { status: "OK", details: "" },
      database: { status: "OK", details: "" },
      browser: { status: "OK", details: "" },
      portalLocks: {},
    },
  };

  // 1. Environment & Mode Check
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;
  if (!hasGroq && !hasGemini) {
    report.checks.environment = {
      status: "WARN",
      details: "No LLM API keys found (GROQ_API_KEY / GEMINI_API_KEY). Extraction and enrichment will run deterministically without LLM assistance.",
    };
  } else {
    report.checks.environment = {
      status: "OK",
      details: `Mode: ${options.mode}. LLM keys present (${[hasGroq && "Groq", hasGemini && "Gemini"].filter(Boolean).join(", ")}).`,
    };
  }

  // 2. Storage Check
  const storageRes = verifyArtifactStorage();
  if (!storageRes.ok) {
    report.checks.storage = {
      status: "FATAL",
      details: storageRes.fatalError || "Essential storage unwritable.",
    };
    report.overallStatus = "FATAL";
  } else if (storageRes.cacheDegraded) {
    report.checks.storage = {
      status: "WARN",
      details: `Essential directories OK. Cache persistence degraded: ${storageRes.warnings.join("; ")}`,
    };
    if (report.overallStatus === "OK") report.overallStatus = "DEGRADED";
  } else {
    report.checks.storage = {
      status: "OK",
      details: `Artifacts directory verified writable at ${ARTIFACTS_DIR}`,
    };
  }

  // 3. Database Check
  try {
    const db = getDatabaseAdapter();
    await db.one("SELECT 1");
    report.checks.database = {
      status: "OK",
      details: "Database adapter connection verified.",
    };
  } catch (err: any) {
    if (options.mode === "SCOPED") {
      report.checks.database = {
        status: "FATAL",
        details: `FATAL: Database connection failed in SCOPED mode: ${err.message}`,
      };
      report.overallStatus = "FATAL";
    } else {
      report.checks.database = {
        status: "DEGRADED",
        details: `Database connection unavailable (${err.message}). GLOBAL_MARKET mode will run in local-only mode.`,
      };
      if (report.overallStatus === "OK") report.overallStatus = "DEGRADED";
    }
  }

  // 4. Browser Smoke Test (Offline about:blank launch and immediate cleanup)
  const tempProfileDir = path.join(
    os.tmpdir(),
    `.radar-preflight-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  try {
    fs.mkdirSync(tempProfileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(tempProfileDir, {
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-setuid-sandbox"],
    });
    const page = await context.newPage();
    await page.goto("about:blank");
    await context.close();
    report.checks.browser = {
      status: "OK",
      details: "Playwright Chromium smoke test passed (about:blank launched and closed).",
    };
  } catch (browserErr: any) {
    const msg = browserErr?.message || String(browserErr);
    if (
      msg.includes("Executable doesn't exist") ||
      msg.includes("Please run the following command to download new browsers") ||
      msg.includes("playwright install")
    ) {
      report.checks.browser = {
        status: "FATAL",
        details: "FATAL: CHROMIUM_NOT_INSTALLED: Chromium browser is not installed. Run 'npx playwright install chromium'.",
      };
    } else {
      report.checks.browser = {
        status: "FATAL",
        details: `FATAL: Browser launch failed: ${msg}`,
      };
    }
    report.overallStatus = "FATAL";
  } finally {
    try {
      if (fs.existsSync(tempProfileDir)) {
        fs.rmSync(tempProfileDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // 5. Portal & Global Lock Check
  const portalsToCheck = options.portals && options.portals.length > 0 ? options.portals : DEFAULT_PORTALS;
  for (const portal of portalsToCheck) {
    const lockPath = profileLockPath(portal);
    if (!fs.existsSync(lockPath)) {
      report.checks.portalLocks[portal] = {
        status: "OK",
        details: "Free (no lock active)",
      };
      continue;
    }

    const existing = readExclusiveLock(lockPath);
    if (!existing) {
      let isFresh = true;
      try {
        const stats = fs.statSync(lockPath);
        isFresh = Date.now() - stats.mtimeMs < 120_000;
      } catch {}

      report.checks.portalLocks[portal] = {
        status: isFresh ? "DEGRADED" : "OK",
        details: isFresh
          ? `Corrupt/unreadable lock file present (fresh: modified < 2m ago). Runtime will reject.`
          : `Stale unreadable lock file present (will be auto-quarantined by runtime).`,
      };
      if (isFresh && report.overallStatus === "OK") {
        report.overallStatus = "DEGRADED";
      }
    } else if (defaultIsProcessAlive(existing.pid)) {
      report.checks.portalLocks[portal] = {
        status: "DEGRADED",
        details: `Locked by active PID ${existing.pid} (owner: ${existing.ownerId})`,
      };
      if (report.overallStatus === "OK") report.overallStatus = "DEGRADED";
    } else {
      report.checks.portalLocks[portal] = {
        status: "OK",
        details: `Stale lock held by dead PID ${existing.pid} (will be auto-reclaimed)`,
      };
    }
  }

  if (options.mode === "GLOBAL_MARKET") {
    const globalLockPath = GLOBAL_MARKET_LOCK_PATH || path.join(RUNS_DIR, ".global_market.lock");
    if (fs.existsSync(globalLockPath)) {
      const existing = readExclusiveLock(globalLockPath);
      if (!existing) {
        let isFresh = true;
        try {
          const stats = fs.statSync(globalLockPath);
          isFresh = Date.now() - stats.mtimeMs < 120_000;
        } catch {}
        if (isFresh) {
          report.checks.portalLocks["GlobalMarket"] = {
            status: "DEGRADED",
            details: "Corrupt/unreadable global market lock file present (fresh). Runtime will reject.",
          };
          if (report.overallStatus === "OK") report.overallStatus = "DEGRADED";
        }
      } else if (defaultIsProcessAlive(existing.pid)) {
        report.checks.portalLocks["GlobalMarket"] = {
          status: "DEGRADED",
          details: `Global market run locked by active PID ${existing.pid}`,
        };
        if (report.overallStatus === "OK") report.overallStatus = "DEGRADED";
      }
    }
  }

  return report;
}

// CLI entry point
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("preflight.ts") || process.argv[1].endsWith("preflight.js"))
) {
  runScraperPreflight()
    .then((report) => {
      console.log("\n=======================================================");
      console.log(` RADAR v2 Scraper Preflight Diagnostic: [${report.overallStatus}]`);
      console.log("=======================================================");
      console.log(`- Environment: [${report.checks.environment.status}] ${report.checks.environment.details}`);
      console.log(`- Storage:     [${report.checks.storage.status}] ${report.checks.storage.details}`);
      console.log(`- Database:    [${report.checks.database.status}] ${report.checks.database.details}`);
      console.log(`- Browser:     [${report.checks.browser.status}] ${report.checks.browser.details}`);
      console.log("- Portal Locks:");
      for (const [p, lock] of Object.entries(report.checks.portalLocks)) {
        console.log(`  * ${p}: [${lock.status}] ${lock.details}`);
      }
      console.log("=======================================================\n");

      if (report.overallStatus === "FATAL") {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(`FATAL: Preflight runner encountered unhandled error: ${err.message}`);
      process.exit(1);
    });
}
