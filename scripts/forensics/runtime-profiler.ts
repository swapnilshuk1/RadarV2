/**
 * scripts/forensics/runtime-profiler.ts
 *
 * RADAR v2 — Automated Runtime & Navigation Performance Forensics Harness.
 *
 * Measures:
 * 1. Server startup latency (spawn -> ready)
 * 2. Navigation timing (TTFB, DOMContentLoaded, Load)
 * 3. Paint timings (FP, FCP, LCP)
 * 4. Hydration & Interactivity milestones
 * 5. Deterministic SPA route transition chain (/ -> /opportunity/:id -> /decisions -> /)
 * 6. Network request & transfer byte accounting (dev module count vs prod chunks)
 * 7. Statistical distribution across N iterations (min, max, p50, p75, p95)
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { generateSessionToken, createSession } from "../../src/lib/auth/session";
import { getDatabaseAdapter } from "../../src/data/database";

export interface BoundaryMetrics {
  serverStartupMs: number;
  ttfbMs: number;
  fcpMs: number;
  lcpMs: number;
  domInteractiveMs: number;
  domCompleteMs: number;
  hydrationToInteractiveMs: number;
  spaNavToDossierMs: number;
  spaNavToDecisionsMs: number;
  spaNavBackToShortlistMs: number;
  totalRequests: number;
  totalTransferBytes: number;
  jsModuleCount: number;
  dossierJobHash?: string;
}

export interface IterationResult {
  iteration: number;
  scenario: string;
  metrics: BoundaryMetrics;
  networkSummary: {
    requests: number;
    totalBytes: number;
    jsBytes: number;
    cssBytes: number;
    jsonBytes: number;
  };
  serverTimings?: Record<string, number>;
}

export interface StatisticalSummary {
  min: number;
  max: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
}

function calculateStats(values: number[]): StatisticalSummary {
  if (values.length === 0) {
    return { min: 0, max: 0, p50: 0, p75: 0, p95: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;

  const quantile = (q: number) => {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  };

  return {
    min: Math.round(min * 10) / 10,
    max: Math.round(max * 10) / 10,
    p50: Math.round(quantile(0.5) * 10) / 10,
    p75: Math.round(quantile(0.75) * 10) / 10,
    p95: Math.round(quantile(0.95) * 10) / 10,
    mean: Math.round(mean * 10) / 10,
  };
}

class ServerProcess {
  private proc: ChildProcess | null = null;
  public startupMs: number = 0;
  public port: number;

  constructor(public mode: "dev" | "prod", port?: number) {
    this.port = port || (mode === "dev" ? 3101 : 3102);
  }

  async start(): Promise<number> {
    const start = performance.now();
    const env = {
      ...process.env,
      PORT: String(this.port),
      NODE_ENV: this.mode === "prod" ? "production" : "development",
      RADAR_ENV: this.mode === "prod" ? "production" : "dev",
    };

    return new Promise<number>((resolve, reject) => {
      if (this.mode === "dev") {
        const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
        this.proc = spawn(cmd, ["vite", "--port", String(this.port), "--host", "127.0.0.1"], {
          env,
          cwd: process.cwd(),
        });
      } else {
        this.proc = spawn("node", [".output/server/index.mjs"], {
          env,
          cwd: process.cwd(),
        });
      }

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          this.kill();
          reject(new Error(`Server failed to start within 25000ms in mode: ${this.mode}`));
        }
      }, 25000);

      const checkOutput = (data: Buffer) => {
        const str = data.toString();
        // Look for Vite ready or Nitro listening message
        if (
          str.includes("ready in") ||
          str.includes("Local:") ||
          str.includes("Listening on") ||
          str.includes("http://") ||
          str.includes(`:${this.port}`)
        ) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.startupMs = performance.now() - start;
            resolve(this.startupMs);
          }
        }
      };

      this.proc.stdout?.on("data", checkOutput);
      this.proc.stderr?.on("data", (data) => {
        const str = data.toString();
        // Nitro sometimes outputs listening info to stderr
        if (str.includes("Listening on") || str.includes(`:${this.port}`)) {
          checkOutput(data);
        }
      });

      this.proc.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  kill() {
    if (this.proc) {
      try {
        if (process.platform === "win32" && this.proc.pid) {
          spawn("taskkill", ["/pid", String(this.proc.pid), "/f", "/t"]);
        } else {
          this.proc.kill("SIGKILL");
        }
      } catch {}
      this.proc = null;
    }
  }
}

async function prepareAuthenticatedSession(): Promise<{ token: string; userJson: string }> {
  const token = generateSessionToken();
  const userId = "swapnil-shukla";

  // Ensure user exists in database and session is inserted
  try {
    await createSession(token, userId);
  } catch (err: any) {
    console.warn(`[Session Warning] Failed to insert session into DB: ${err.message}. Proceeding with simulated cookie.`);
  }

  const userJson = JSON.stringify({
    id: userId,
    email: "swapnil@radar.local",
    name: "Swapnil Shukla",
    onboarded: true,
    role: "executive",
  });

  return { token, userJson };
}

async function runSingleIteration(
  browser: Browser,
  port: number,
  mode: "dev" | "prod",
  iterationNum: number,
  sessionInfo: { token: string; userJson: string }
): Promise<IterationResult> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 RADAR-Profiler",
  });

  // Inject authentication cookies & sessionStorage before navigation
  await context.addCookies([
    {
      name: "radar_session",
      value: sessionInfo.token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
    {
      name: "radar_session",
      value: sessionInfo.token,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();

  // Pre-seed sessionStorage so client-side auth guard passes instantly
  await page.addInitScript((userData) => {
    try {
      sessionStorage.setItem("radar_session", userData);
      localStorage.setItem("radar_onboarding_completed", "true");
    } catch {}
  }, sessionInfo.userJson);

  // Network tracking
  const networkRequests: Array<{
    url: string;
    status: number;
    contentType: string;
    transferBytes: number;
    durationMs: number;
  }> = [];

  page.on("response", async (response) => {
    try {
      const headers = response.headers();
      const contentType = headers["content-type"] || "";
      const contentLength = parseInt(headers["content-length"] || "0", 10);
      networkRequests.push({
        url: response.url(),
        status: response.status(),
        contentType,
        transferBytes: contentLength,
        durationMs: 0,
      });
    } catch {}
  });

  const baseUrl = `http://localhost:${port}`;

  // 1. Initial Page Load (Shortlist /)
  const navStart = performance.now();
  await page.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 45000 });

  // Wait for shortlist content to mount & interactive controls
  await page.waitForSelector(".memo-container, h1, [data-testid='opportunity-card'], article, div.border-border", {
    timeout: 15000,
  });

  // Collect Browser Performance Timing
  const perfData = await page.evaluate(() => {
    const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const nav = navEntries.length > 0 ? navEntries[0] : null;
    const paintEntries = performance.getEntriesByType("paint");
    const fp = paintEntries.find((p) => p.name === "first-paint")?.startTime || 0;
    const fcp = paintEntries.find((p) => p.name === "first-contentful-paint")?.startTime || 0;

    return {
      ttfb: nav ? nav.responseStart - nav.requestStart : 0,
      domInteractive: nav ? nav.domInteractive : 0,
      domComplete: nav ? nav.domComplete : 0,
      duration: nav ? nav.duration : 0,
      fp,
      fcp,
    };
  });

  // Calculate LCP via evaluate
  const lcpMs = await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      let maxLcp = 0;
      const observer = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        for (const entry of entries) {
          if (entry.startTime > maxLcp) maxLcp = entry.startTime;
        }
      });
      try {
        observer.observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(maxLcp);
        }, 300);
      } catch {
        resolve(0);
      }
    });
  });

  const interactiveTimestamp = performance.now();
  const hydrationToInteractiveMs = Math.max(0, interactiveTimestamp - navStart - perfData.domInteractive);

  // Find first opportunity card to navigate to Dossier
  let spaNavToDossierMs = 0;
  let dossierJobHash = "";

  // Expand first card row if closed
  const cardRowButton = page.locator("button[aria-expanded]").first();
  if ((await cardRowButton.count()) > 0) {
    await cardRowButton.click();
    await page.waitForTimeout(300);
  }

  const oppLink = page.locator("a[href*='/opportunity/']").first();
  const hasOppLink = (await oppLink.count()) > 0;

  if (hasOppLink) {
    const href = (await oppLink.getAttribute("href")) || "";
    dossierJobHash = href.split("/opportunity/")[1]?.split("?")[0] || "";
    const clickTime = performance.now();
    await oppLink.click();
    await page.waitForSelector("h1, .memo-container, [data-surface='executive-briefing'], section", {
      timeout: 10000,
    });
    spaNavToDossierMs = performance.now() - clickTime;
  }

  // SPA Nav to Decisions Ledger
  let spaNavToDecisionsMs = 0;
  const decisionsLink = page.locator("a[href='/decisions'], a:has-text('Decisions')").first();
  if ((await decisionsLink.count()) > 0) {
    const clickTime = performance.now();
    await decisionsLink.click();
    await page.waitForSelector("h1, .memo-container, table, div.border-border", { timeout: 10000 });
    spaNavToDecisionsMs = performance.now() - clickTime;
  }

  // SPA Nav back to Shortlist
  let spaNavBackToShortlistMs = 0;
  const shortlistLink = page.locator("a[href='/'], a:has-text('Shortlist'), a:has-text('RADAR')").first();
  if ((await shortlistLink.count()) > 0) {
    const clickTime = performance.now();
    await shortlistLink.click();
    await page.waitForSelector(".memo-container, h1, [data-testid='opportunity-card']", { timeout: 10000 });
    spaNavBackToShortlistMs = performance.now() - clickTime;
  }

  // Compute network aggregates
  let totalTransferBytes = 0;
  let jsBytes = 0;
  let cssBytes = 0;
  let jsonBytes = 0;
  let jsModuleCount = 0;

  for (const req of networkRequests) {
    totalTransferBytes += req.transferBytes;
    if (req.contentType.includes("javascript") || req.url.endsWith(".js") || req.url.endsWith(".ts") || req.url.endsWith(".tsx")) {
      jsBytes += req.transferBytes;
      jsModuleCount++;
    } else if (req.contentType.includes("css") || req.url.endsWith(".css")) {
      cssBytes += req.transferBytes;
    } else if (req.contentType.includes("json")) {
      jsonBytes += req.transferBytes;
    }
  }

  await context.close();

  return {
    iteration: iterationNum,
    scenario: `${mode.toUpperCase()} Iteration ${iterationNum}`,
    metrics: {
      serverStartupMs: 0, // Injected by runner
      ttfbMs: Math.round(perfData.ttfb * 10) / 10,
      fcpMs: Math.round(perfData.fcp * 10) / 10,
      lcpMs: Math.round((lcpMs || perfData.fcp) * 10) / 10,
      domInteractiveMs: Math.round(perfData.domInteractive * 10) / 10,
      domCompleteMs: Math.round(perfData.domComplete * 10) / 10,
      hydrationToInteractiveMs: Math.round(hydrationToInteractiveMs * 10) / 10,
      spaNavToDossierMs: Math.round(spaNavToDossierMs * 10) / 10,
      spaNavToDecisionsMs: Math.round(spaNavToDecisionsMs * 10) / 10,
      spaNavBackToShortlistMs: Math.round(spaNavBackToShortlistMs * 10) / 10,
      totalRequests: networkRequests.length,
      totalTransferBytes,
      jsModuleCount,
      dossierJobHash,
    },
    networkSummary: {
      requests: networkRequests.length,
      totalBytes: totalTransferBytes,
      jsBytes,
      cssBytes,
      jsonBytes,
    },
  };
}

export async function runForensicSuite(options: { mode: "dev" | "prod" | "both"; iterations?: number }) {
  const iterations = options.iterations || 5;
  const modes: Array<"dev" | "prod"> = options.mode === "both" ? ["dev", "prod"] : [options.mode];

  console.log("===============================================================");
  console.log("  RADAR v2 — Application Runtime & Navigation Performance Forensics");
  console.log(`  Iterations: ${iterations} per scenario | Modes: ${modes.join(", ").toUpperCase()}`);
  console.log("===============================================================\n");

  const artifactsDir = path.join(process.cwd(), "scripts", "forensics", "artifacts");
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

  const sessionInfo = await prepareAuthenticatedSession();
  const suiteResults: Record<string, { iterations: IterationResult[]; stats: Record<string, StatisticalSummary> }> = {};

  const browser = await chromium.launch({ headless: true });

  try {
    for (const mode of modes) {
      console.log(`\n---------------------------------------------------------------`);
      console.log(`Starting Test Suite for Mode: ${mode.toUpperCase()}`);
      console.log(`---------------------------------------------------------------`);

      // 1. Measure Cold Server Startup
      console.log(`[1/3] Measuring Cold Server Startup...`);
      const coldServer = new ServerProcess(mode);
      const coldStartupMs = await coldServer.start();
      console.log(`  -> Server listening on port ${coldServer.port} in ${Math.round(coldStartupMs)}ms`);

      const modeIterationResults: IterationResult[] = [];

      // 2. Measure Cold First Request
      console.log(`[2/3] Measuring First Request & Full SPA Navigation (Cold Context)...`);
      const firstResult = await runSingleIteration(browser, coldServer.port, mode, 1, sessionInfo);
      firstResult.metrics.serverStartupMs = Math.round(coldStartupMs * 10) / 10;
      modeIterationResults.push(firstResult);

      console.log(`  -> Iteration 1: TTFB=${firstResult.metrics.ttfbMs}ms | FCP=${firstResult.metrics.fcpMs}ms | LCP=${firstResult.metrics.lcpMs}ms`);
      console.log(`     SPA Navs: Dossier=${firstResult.metrics.spaNavToDossierMs}ms | Decisions=${firstResult.metrics.spaNavToDecisionsMs}ms | Back=${firstResult.metrics.spaNavBackToShortlistMs}ms`);
      console.log(`     Network: Requests=${firstResult.metrics.totalRequests} | JS Modules=${firstResult.metrics.jsModuleCount} | Transfer=${(firstResult.metrics.totalTransferBytes / 1024).toFixed(1)} KB`);

      // 3. Measure Warm Steady-State Requests (Iterations 2..N)
      console.log(`[3/3] Measuring Warm Steady-State Requests (${iterations - 1} iterations)...`);
      for (let i = 2; i <= iterations; i++) {
        await new Promise((r) => setTimeout(r, 600)); // Pacing between iterations
        const result = await runSingleIteration(browser, coldServer.port, mode, i, sessionInfo);
        result.metrics.serverStartupMs = Math.round(coldStartupMs * 10) / 10;
        modeIterationResults.push(result);
        console.log(`  -> Iteration ${i}: TTFB=${result.metrics.ttfbMs}ms | FCP=${result.metrics.fcpMs}ms | LCP=${result.metrics.lcpMs}ms | DossierNav=${result.metrics.spaNavToDossierMs}ms`);
      }

      coldServer.kill();

      // Aggregate Statistics
      const extractMetric = (key: keyof BoundaryMetrics) => modeIterationResults.map((r) => (r.metrics[key] as number) || 0);

      const stats: Record<string, StatisticalSummary> = {
        serverStartupMs: calculateStats(extractMetric("serverStartupMs")),
        ttfbMs: calculateStats(extractMetric("ttfbMs")),
        fcpMs: calculateStats(extractMetric("fcpMs")),
        lcpMs: calculateStats(extractMetric("lcpMs")),
        domInteractiveMs: calculateStats(extractMetric("domInteractiveMs")),
        domCompleteMs: calculateStats(extractMetric("domCompleteMs")),
        hydrationToInteractiveMs: calculateStats(extractMetric("hydrationToInteractiveMs")),
        spaNavToDossierMs: calculateStats(extractMetric("spaNavToDossierMs")),
        spaNavToDecisionsMs: calculateStats(extractMetric("spaNavToDecisionsMs")),
        spaNavBackToShortlistMs: calculateStats(extractMetric("spaNavBackToShortlistMs")),
        totalRequests: calculateStats(extractMetric("totalRequests")),
        totalTransferBytes: calculateStats(extractMetric("totalTransferBytes")),
        jsModuleCount: calculateStats(extractMetric("jsModuleCount")),
      };

      suiteResults[mode] = {
        iterations: modeIterationResults,
        stats,
      };

      // Save mode raw trace artifact
      fs.writeFileSync(
        path.join(artifactsDir, `raw-traces-${mode}.json`),
        JSON.stringify(suiteResults[mode], null, 2)
      );
    }

    // Save combined raw trace artifact
    fs.writeFileSync(
      path.join(artifactsDir, `raw-traces-combined.json`),
      JSON.stringify(suiteResults, null, 2)
    );

    // Print Comparative Forensic Table
    console.log("\n==========================================================================================");
    console.log("                       RADAR v2 FORENSIC PERFORMANCE BASELINE MATRIX                      ");
    console.log("==========================================================================================");
    console.log(
      "Boundary / Metric".padEnd(30) +
      "Dev p50".padEnd(12) +
      "Dev p95".padEnd(12) +
      "Prod p50".padEnd(12) +
      "Prod p95".padEnd(12) +
      "Classification"
    );
    console.log("─".repeat(90));

    const metricsToDisplay: Array<{ key: string; label: string; classification: string }> = [
      { key: "serverStartupMs", label: "Server Startup", classification: "Tooling / Node init" },
      { key: "ttfbMs", label: "Initial TTFB", classification: "SSR / DB Cloud RT" },
      { key: "fcpMs", label: "First Contentful Paint", classification: "Browser Network / HTML" },
      { key: "lcpMs", label: "Largest Contentful Paint", classification: "Layout / Hydration" },
      { key: "domInteractiveMs", label: "DOM Interactive", classification: "HTML parsing" },
      { key: "hydrationToInteractiveMs", label: "Hydration -> Interactive", classification: "JS Runtime / Events" },
      { key: "spaNavToDossierMs", label: "SPA: / -> Dossier", classification: "RPC / DB / UI Render" },
      { key: "spaNavToDecisionsMs", label: "SPA: Dossier -> Decisions", classification: "RPC / DB / UI Render" },
      { key: "spaNavBackToShortlistMs", label: "SPA: Decisions -> /", classification: "Client Cache / Settle" },
      { key: "totalRequests", label: "HTTP Requests Count", classification: "Network Roundtrips" },
      { key: "jsModuleCount", label: "JS Module Count", classification: "Dev Bundling Overhead" },
      { key: "totalTransferBytes", label: "Transfer Bytes (KB)", classification: "Payload Size" },
    ];

    for (const m of metricsToDisplay) {
      const devStats = suiteResults.dev?.stats[m.key];
      const prodStats = suiteResults.prod?.stats[m.key];

      const devP50 = devStats ? (m.key === "totalTransferBytes" ? `${(devStats.p50 / 1024).toFixed(1)} KB` : `${devStats.p50} ms`) : "N/A";
      const devP95 = devStats ? (m.key === "totalTransferBytes" ? `${(devStats.p95 / 1024).toFixed(1)} KB` : `${devStats.p95} ms`) : "N/A";
      const prodP50 = prodStats ? (m.key === "totalTransferBytes" ? `${(prodStats.p50 / 1024).toFixed(1)} KB` : `${prodStats.p50} ms`) : "N/A";
      const prodP95 = prodStats ? (m.key === "totalTransferBytes" ? `${(prodStats.p95 / 1024).toFixed(1)} KB` : `${prodStats.p95} ms`) : "N/A";

      console.log(
        m.label.padEnd(30) +
        devP50.padEnd(12) +
        devP95.padEnd(12) +
        prodP50.padEnd(12) +
        prodP95.padEnd(12) +
        m.classification
      );
    }
    console.log("==========================================================================================\n");

  } finally {
    await browser.close();
  }
}

// CLI Execution Entrypoint
const modeArg = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] as any || "both";
const iterArg = parseInt(process.argv.find((a) => a.startsWith("--iterations="))?.split("=")[1] || "5", 10);

runForensicSuite({ mode: modeArg, iterations: iterArg }).catch((err) => {
  console.error("Forensic Suite Error:", err);
  process.exit(1);
});
